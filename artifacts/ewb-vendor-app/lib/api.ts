import { Platform } from 'react-native';
import type { Confidence, EwbRecord, GstSnapshot } from '@/lib/domain';

/**
 * Client for the trusted backend (artifacts/api-server). Provider calls,
 * entitlement checks and PDF parsing only happen there; the app never talks
 * to an EWB/GST provider directly.
 */

function resolveBaseUrl() {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    return hostname === 'localhost' || hostname === '127.0.0.1' ? `${protocol}//${hostname}:5000` : `${protocol}//${window.location.host}`;
  }
  return Platform.OS === 'android' ? 'http://10.0.2.2:5000' : 'http://localhost:5000';
}

export const API_BASE = resolveBaseUrl();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

type Identity = { workspaceId: string | null; getToken: (() => Promise<string | null>) | null };
let identity: Identity = { workspaceId: null, getToken: null };

export function setApiIdentity(next: Identity) {
  identity = next;
}

async function request<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number; idToken?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (identity.workspaceId) headers['x-workspace-id'] = identity.workspaceId;
  // An explicit token (registration finalize) wins over the signed-in session's token.
  const token = init.idToken ?? (identity.getToken ? await identity.getToken().catch(() => null) : null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    throw new ApiError(aborted ? 'The server took too long to respond.' : 'You appear to be offline, or the service is unreachable.', 0, aborted ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (!response.ok) {
    throw new ApiError(typeof json.message === 'string' ? json.message : `Request failed (${response.status}).`, response.status, typeof json.error === 'string' ? json.error : 'error', json);
  }
  return json as T;
}

export type ProviderInfo = { id: string; label: string; sandbox: boolean } | null;
export type PaymentStep = 'wallet_opened' | 'checkout_opened' | 'checkout_closed' | 'payment_page_opened' | 'returned_paid' | 'returned_unpaid' | 'payment_error';
export type WalletAction = 'generate' | 'part_b' | 'consolidate' | 'cancel' | 'extend' | 'gst_verify';
export type CreditCosts = Record<WalletAction, number>;
export type ServiceConfig = {
  authMode: string;
  /** "Video tutorial" link (Help & data); null until one is set on the server. */
  tutorialVideoUrl?: string | null;
  ewbProvider: ProviderInfo;
  gstProvider: ProviderInfo;
  billingMode: string;
  pdfParser: string;
  gstinVerification?: boolean;
  emailOtp?: boolean;
  ewbCredentialsRequired?: boolean;
  creditCosts?: CreditCosts;
  /** The server can look up road distances between PIN codes. */
  distanceLookup?: boolean;
  /** Android version codes: below `minVersionCode` the app must update; below `latestVersionCode` it is offered (0 = off). */
  androidUpdate?: { minVersionCode: number; latestVersionCode: number; message: string; storeUrl: string };
};
/** Registered details for a GSTIN, from the server's verified-GSTIN registry. */
export type VerifiedGstin = {
  gstin: string;
  legalName: string;
  tradeName: string;
  status: string;
  taxpayerType: string;
  registrationDate: string | null;
  cancellationDate: string | null;
  stateCode: string;
  state: string;
  address: string;
  city: string;
  pincode: string;
  blockStatus: string | null;
  verifiedAt: string;
  /** When the status (Active / Cancelled) was last confirmed with the GST network. */
  statusCheckedAt?: string;
};
export type WalletEntry = {
  id: string;
  at: string;
  kind: WalletAction | 'grant' | 'topup';
  credits: number;
  status: 'charged' | 'refunded' | 'credited';
  label: string;
  ewbNumber?: string;
  note?: string;
};
export type WalletPricing = { creditPricePaise: number; packs: number[]; min: number; max: number; payments: 'razorpay' | 'sandbox' | 'off' };
/** A month (YYYY-MM, India time) with wallet activity: entries, credits added and used. */
export type WalletMonth = { month: string; count: number; added: number; used: number };
export type WalletSummary = { balance: number; costs: CreditCosts; counts: Record<WalletAction, number>; creditsUsed: number; ledger: WalletEntry[]; ledgerMore?: boolean; historyMonths?: WalletMonth[]; pricing?: WalletPricing; /** Free trial credits still to come (after the first portal login is saved). */ welcomeCredits?: number; /** New GSTIN lookups free for this account, and how many are used. */ gstLookups?: { free: number; used: number } };
export type CreditPurchase = { id: string; provider: 'razorpay' | 'sandbox'; credits: number; amountPaise: number; status: 'created' | 'paid' | 'expired' | 'cancelled'; shortUrl?: string; createdAt: string; paidAt?: string; paymentId?: string; invoiceNumber?: string };
/** Invoice for a credit purchase, numbered per financial year (EWE/2026-27/0001). */
export type BillingInvoice = {
  number: string; purchaseId: string; issuedAt: string; paidAt: string; paymentId: string | null; provider: 'razorpay' | 'sandbox';
  credits: number; amountPaise: number; ratePaise: number;
  buyer: { name: string; gstin: string; address: string; state: string; pincode: string; email: string; phone: string };
  emailedTo?: string; emailedAt?: string;
};
export type CewbRecord = {
  id: string;
  cewbNumber: string;
  provider: string;
  ewbIds: string[];
  ewbNumbers: string[];
  vehicleNumber: string;
  fromPlace: string;
  fromState: string;
  transMode: string;
  generatedAt: string;
};
export type EwbCredential = { gstin: string; username: string; updatedAt: string };
type Movement = { fromPlace?: string; fromState?: string };
export type ProviderIssue = { field: string; section: 'seller' | 'buyer' | 'invoice' | 'items' | 'transport'; message: string };
export type Plan = { id: string; name: string; pricePaise: number; cadence: string; ewbLimit: number | null; gstins: number; users: number; features: string[] };
export type Subscription = {
  planId: string;
  entitlementState: 'trial' | 'active' | 'grace' | 'expired';
  usagePeriod: string;
  usageCount: number;
  renewalAt: string;
  billingHistory: { at: string; planId: string; amountPaise: number; reference: string }[];
};
type Candidate<T = string> = { value: T; confidence: Confidence };
export type ExtractedInvoice = {
  invoiceNumber?: Candidate; invoiceDate?: Candidate;
  sellerName?: Candidate; sellerGstin?: Candidate; sellerState?: Candidate; sellerPincode?: Candidate;
  buyerName?: Candidate; buyerGstin?: Candidate; buyerState?: Candidate; buyerPincode?: Candidate;
  totalPaise?: Candidate<number>; taxablePaise?: Candidate<number>;
  lines: { description: string; hsn: string; quantity: string; unit?: string; unitPricePaise?: number; taxablePaise: number; taxRate: number; confidence: Confidence }[];
  pageCount: number;
};
export type SyncEnvelope = { id: string; updatedAt: string; deleted?: boolean; data?: unknown };

export const api = {
  health: () => request<{ status: string }>('/healthz', { timeoutMs: 6000 }),
  config: () => request<ServiceConfig>('/config', { timeoutMs: 8000 }),
  /** Whether this account accepted the current Terms & Privacy Policy. */
  consent: () => request<{ version: string; accepted: { version: string; acceptedAt: string } | null; required: boolean }>('/consent', { timeoutMs: 15_000 }),
  acceptConsent: (version: string, method: 'signup' | 'google' | 'prompt') => request<{ version: string; acceptedAt: string }>('/consent', { body: { version, method }, timeoutMs: 15_000 }),
  validateEwb: (input: unknown) => request<{ issues: ProviderIssue[]; warnings: string[]; provider: ProviderInfo }>('/ewb/validate', { body: { input } }),
  generateEwb: (idempotencyKey: string, input: unknown) => request<{ ewb: EwbRecord; replay?: boolean; balance?: number }>('/ewb/generate', { body: { idempotencyKey, input }, timeoutMs: 45_000 }),
  /** With `since` (an earlier list's `serverTime`), only the bills changed after it (`full: false`); servers before this read sent no `full` or `serverTime`. */
  listEwbs: (since?: string) => request<{ ewbs: EwbRecord[]; full?: boolean; serverTime?: string; provider: ProviderInfo }>(since ? `/ewb?since=${encodeURIComponent(since)}` : '/ewb'),
  getEwb: (id: string) => request<{ ewb: EwbRecord }>(`/ewb/${encodeURIComponent(id)}`),
  ewbAction: (id: string, body: { action: 'cancel'; reason: string } | ({ action: 'extend'; reason: string; remainingKm: number; fromPincode?: string } & Movement) | ({ action: 'update_vehicle'; reason: string; vehicleNumber: string } & Movement)) =>
    request<{ ewb: EwbRecord; balance?: number }>(`/ewb/${encodeURIComponent(id)}/actions`, { body, timeoutMs: 45_000 }),
  listConsolidated: () => request<{ cewbs: CewbRecord[] }>('/ewb-consolidated'),
  consolidate: (body: { ewbIds: string[]; vehicleNumber: string; fromPlace: string; fromState: string; transMode?: string }) =>
    request<{ cewb: CewbRecord; balance: number }>('/ewb-consolidated', { body, timeoutMs: 45_000 }),
  ewbCredentials: () => request<{ credentials: EwbCredential[]; required: boolean; canStore: boolean; provider?: 'live' | 'test' | 'none'; providerId?: string | null }>('/ewb-credentials'),
  saveEwbCredential: (gstin: string, username: string, password: string) =>
    request<{ credential: EwbCredential; checked: boolean; message: string; welcomeCredits?: number; balance?: number }>('/ewb-credentials', { method: 'PUT', body: { gstin, username, password }, timeoutMs: 30_000 }),
  deleteEwbCredential: (gstin: string) => request<{ ok: true }>(`/ewb-credentials/${encodeURIComponent(gstin)}`, { method: 'DELETE' }),
  /** Road distance between two PIN codes (Google Routes, looked up once per pair on the server). */
  distance: (from: string, to: string) => request<{ from: string; to: string; km: number; cached: boolean }>(`/distance?from=${from}&to=${to}`, { timeoutMs: 20_000 }),
  /** `pay`: the user agreed to spend credits on a new lookup past the free ones (402 credit_needed asks). */
  verifyGstin: (gstin: string, pay = false) => request<{ gstin: VerifiedGstin; cached: boolean; stale?: boolean; charged?: number; freeLeft?: number }>('/gstin/verify', { body: { gstin, ...(pay ? { pay: true } : {}) }, timeoutMs: 30_000 }),
  /** The app was opened: counted for daily active users in the admin panel. */
  appOpened: (platform: 'android' | 'ios' | 'web', appVersion: string) => request<Record<string, never>>('/activity/open', { body: { platform, appVersion }, timeoutMs: 10_000 }),
  /** A step buying credits, for the admin panel's payment log. */
  paymentStep: (step: PaymentStep, details: { credits?: number; purchaseId?: string; note?: string; appVersion?: string } = {}) => request<Record<string, never>>('/activity/payment', { body: { step, ...details }, timeoutMs: 10_000 }),
  wallet: () => request<WalletSummary>('/wallet'),
  /** One page of history, newest first: a month (YYYY-MM) or every month (''), after the entry `before`. */
  walletHistory: (month: string, limit: number, before?: string) =>
    request<{ month: string; entries: WalletEntry[]; more: boolean }>(`/wallet/history?month=${encodeURIComponent(month)}&limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  /** Reset email from our server (link opens our page, then the app). */
  requestPasswordReset: (email: string) => request<{ message: string }>('/auth/password-reset', { body: { email }, timeoutMs: 30_000 }),
  sendEmailOtp: (email: string) => request<{ message: string; cooldownSeconds: number }>('/auth/email-otp/send', { body: { email }, timeoutMs: 30_000 }),
  verifyEmailOtp: (email: string, code: string) => request<{ grant: string; expiresInSeconds: number }>('/auth/email-otp/verify', { body: { email, code } }),
  finalizeRegistration: (grant: string, idToken: string) => request<{ activated: boolean }>('/auth/register/finalize', { body: { grant }, idToken, timeoutMs: 30_000 }),
  buyCredits: (credits: number) => request<{ purchase: CreditPurchase; balance?: number }>('/wallet/purchase', { body: { credits }, timeoutMs: 30_000 }),
  billingInvoices: () => request<{ invoices: BillingInvoice[]; payments: CreditPurchase[] }>('/wallet/invoices', { timeoutMs: 30_000 }),
  billingInvoice: (id: string) => request<{ invoice: BillingInvoice; html: string }>(`/wallet/invoices/${encodeURIComponent(id)}`, { timeoutMs: 20_000 }),
  emailBillingInvoice: (id: string) => request<{ emailedTo: string; emailedAt: string }>(`/wallet/invoices/${encodeURIComponent(id)}/email`, { body: {}, timeoutMs: 30_000 }),
  purchaseStatus: (id: string) => request<{ purchase: CreditPurchase; balance: number }>(`/wallet/purchase/${encodeURIComponent(id)}`, { timeoutMs: 30_000 }),
  gstStatus: (gstin: string, period: string) => request<{ snapshots: GstSnapshot[]; provider: ProviderInfo }>(`/gst/status?gstin=${encodeURIComponent(gstin)}&period=${encodeURIComponent(period)}`),
  refreshGst: (gstin: string, period: string) => request<{ snapshots: GstSnapshot[]; provider: ProviderInfo }>('/gst/refresh', { body: { gstin, period } }),
  /** `ownGstins`: the user's registrations, so the PDF reader never takes one as the buyer's. */
  parsePdf: (fileName: string, contentBase64: string, ownGstins: string[] = []) => request<{ fields: ExtractedInvoice; parserVersion: string; retention: string }>('/pdf/parse', { body: { fileName, contentBase64, ownGstins }, timeoutMs: 60_000 }),
  subscription: () => request<{ subscription: Subscription; plan: Plan; plans: Plan[]; plansAreSamples: boolean; billingMode: string }>('/subscription'),
  changePlan: (planId: string) => request<{ subscription: Subscription; plan: Plan }>('/subscription/change', { body: { planId } }),
  sync: (since: string | undefined, collections: Record<string, SyncEnvelope[]>) =>
    request<{ serverTime: string; changes: Record<string, SyncEnvelope[]> }>('/sync', { body: { since, collections }, timeoutMs: 30_000 }),
};

/** Support inbox; set EXPO_PUBLIC_SUPPORT_EMAIL before release. */
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '';
