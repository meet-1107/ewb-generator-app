/**
 * Shared invoice / e-way bill domain model. Money is integer paise; dates are
 * ISO `YYYY-MM-DD` (invoice) or ISO timestamps (records). Validation here is
 * for fast feedback only — the backend re-validates before any provider call.
 */

export type InvoiceStatus = 'draft' | 'ready' | 'ewb_generated';
export type SupplyType = 'intra' | 'inter';
export type Confidence = 'high' | 'medium' | 'low';

export type InvoiceLine = {
  id: string;
  description: string;
  hsn: string;
  quantity: string;
  unit: string;
  unitPricePaise?: number;
  /** Discount on this line, already taken off `taxablePaise`. */
  discountPaise?: number;
  taxablePaise: number;
  taxRate: number;
};

export type Invoice = {
  id: string;
  /** 'purchase': a bill from a party (the seller) to you (the buyer). Absent on older invoices: a sale. */
  kind?: 'sale' | 'purchase';
  invoiceNumber: string;
  invoiceDate: string;
  documentType: string;
  sellerName: string;
  sellerGstin: string;
  sellerAddress: string;
  sellerState: string;
  sellerPincode: string;
  /** Dispatch place, when goods leave from somewhere other than the seller's address. */
  dispatchFrom: string;
  dispatchState: string;
  dispatchPincode: string;
  buyerName: string;
  buyerGstin: string;
  buyerAddress: string;
  buyerState: string;
  buyerPincode: string;
  /** Delivery place, when not the buyer's address. */
  shipTo: string;
  shipToState: string;
  shipToPincode: string;
  /** PIN pair ("411001-560001") the distance was looked up for; a change looks it up again. */
  distanceFor?: string;
  placeOfSupply: string;
  supplyType: SupplyType;
  lines: InvoiceLine[];
  transporterName: string;
  transporterId: string;
  vehicleNumber: string;
  transportMode: string;
  distanceKm: string;
  transportDocNo: string;
  transportDocDate: string;
  vehicleType: 'regular' | 'odc';
  notes: string;
  templateId: string;
  templateVersion: number;
  schemaVersion: number;
  createdBy?: string;
  updatedBy?: string;
  sourceFileName?: string;
  extraction?: { parserVersion: string; fields: Record<string, Confidence>; original: Record<string, string>; confirmed: boolean };
  ewbId?: string;
  ewbNumber?: string;
  idempotencyKey?: string;
  /** Bank details printed on the invoice; empty means none. */
  bank?: InvoiceBank | null;
  /** false: the user said this invoice needs no e-way bill. */
  ewbRequired?: boolean;
  /** A new invoice not saved from the preview yet: hidden from lists and numbering, deleted if abandoned. */
  unsaved?: boolean;
  status: InvoiceStatus;
  createdAt: string;
  updatedAt: string;
  revisionHistory: InvoiceRevision[];
};

export type InvoiceRevision = Omit<Invoice, 'revisionHistory'>;

export const isPurchase = (invoice: Pick<Invoice, 'kind'>) => invoice.kind === 'purchase';

export type GstRegistration = {
  gstin: string;
  displayName: string;
  state: string;
  isDefault: boolean;
};

/**
 * The authorised signatory's signature, saved once and printed on every invoice:
 * drawn in the app (SVG path strokes in a width × height box) or an uploaded image.
 */
export type Signature =
  | { kind: 'drawn'; paths: string[]; width: number; height: number; updatedAt: string }
  | { kind: 'image'; dataUri: string; updatedAt: string };

/** Largest uploaded signature image (base64 data URI), so the profile stays small to sync. */
export const MAX_SIGNATURE_BYTES = 250_000;

/** The signature as HTML for the PDF (inline SVG or image), sized to fit the signatory box. */
export function signatureHtml(signature: Signature | undefined, color = '#1b2420') {
  if (!signature) return '';
  if (signature.kind === 'image') return `<img src="${signature.dataUri}" alt="" style="max-height:48px;max-width:160px;object-fit:contain" />`;
  const paths = signature.paths.map((d) => `<path d="${d.replace(/[^0-9MLQCZmlqcz .,-]/g, '')}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${signature.width} ${signature.height}" style="height:48px;max-width:160px">${paths}</svg>`;
}

export type Business = {
  name: string;
  gstin: string;
  state: string;
  address: string;
  pincode?: string;
  phone: string;
  email: string;
  timezone: string;
  /** Old setting, no longer used: numbers continue from the last invoice (`nextInvoiceNumber`). */
  invoicePrefix?: string;
  defaultTemplateId?: string;
  gstRegistrations?: GstRegistration[];
  defaultGstin?: string;
  verified?: GstinVerification;
  /** Bank accounts that can be printed on invoices; `defaultBankId` fills new invoices. */
  bankAccounts?: BankAccount[];
  defaultBankId?: string;
  /** Printed above "Authorised signatory" on every invoice. */
  signature?: Signature;
  updatedAt?: string;
};

export const BANK_ACCOUNT_TYPES = ['Current', 'Savings', 'Cash credit / OD'] as const;
export type BankAccount = {
  id: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
  accountType: (typeof BANK_ACCOUNT_TYPES)[number];
  upiId?: string;
  updatedAt: string;
};
/** The bank details printed on one invoice (a copy, so later edits do not change it). */
export type InvoiceBank = Omit<BankAccount, 'updatedAt'>;

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Field problems in a bank account form, keyed by field. */
export function bankAccountProblems(bank: Partial<BankAccount>) {
  const problems: Partial<Record<keyof BankAccount, string>> = {};
  if (!bank.accountName?.trim()) problems.accountName = 'Account holder name is required.';
  if (!bank.bankName?.trim()) problems.bankName = 'Bank name is required.';
  if (!/^\d{9,18}$/.test(bank.accountNumber ?? '')) problems.accountNumber = 'Account number must be 9 to 18 digits.';
  if (!IFSC_PATTERN.test(bank.ifsc ?? '')) problems.ifsc = 'IFSC is 11 characters, like SBIN0001234.';
  if (bank.upiId && !/^[\w.-]{2,}@[A-Za-z]{2,}$/.test(bank.upiId)) problems.upiId = 'UPI ID looks wrong (e.g. business@okhdfc).';
  return problems;
}

export function invoiceBank(bank: BankAccount): InvoiceBank {
  const { updatedAt: _updatedAt, ...rest } = bank;
  return rest;
}

/** Bank details as plain text, for sharing on WhatsApp, SMS or email. */
export function bankShareText(bank: Omit<BankAccount, 'id' | 'updatedAt'>) {
  return [
    'Bank details',
    `Account name: ${bank.accountName}`,
    `Bank: ${bank.bankName}${bank.branch ? `, ${bank.branch}` : ''}`,
    `Account number: ${bank.accountNumber}`,
    `IFSC: ${bank.ifsc}`,
    `Account type: ${bank.accountType}`,
    bank.upiId ? `UPI: ${bank.upiId}` : '',
  ].filter(Boolean).join('\n');
}

/** The business's default bank account, or its first one. */
export function defaultBank(business: Business | null | undefined) {
  const banks = business?.bankAccounts ?? [];
  return banks.find((bank) => bank.id === business?.defaultBankId) ?? banks[0] ?? null;
}

/** Summary of a GSTIN verification, kept with the saved business / buyer. */
export type GstinVerification = { legalName: string; tradeName: string; status: string; verifiedAt: string; city?: string };
export type Party = { id: string; name: string; gstin: string; address: string; state: string; pincode: string; phone: string; updatedAt: string; verified?: GstinVerification };
export type Product = { id: string; name: string; hsn: string; unit: string; taxRate: number; unitPricePaise: number; updatedAt: string };
export type Transporter = { id: string; name: string; transporterId: string; vehicleNumber: string; phone?: string; updatedAt: string };

/** Transporter ID: a GSTIN or a 15-character TRANSIN from the e-way bill portal. */
export function transporterIdProblem(raw: string) {
  const id = raw.trim().toUpperCase();
  if (!id) return 'Transporter ID is required.';
  if (!/^\d{2}[A-Z0-9]{13}$/.test(id)) return 'Transporter ID is 15 characters (GSTIN or TRANSIN).';
  return null;
}

/** The name to use for a verified GSTIN: the business (trade) name, not the owner's legal name. */
export function businessNameOf(details: { legalName: string; tradeName: string }) {
  return details.tradeName.trim() || details.legalName.trim();
}

export type EwbStatus = 'active' | 'expired' | 'cancelled' | 'part_b_pending';
export type EwbRecord = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  provider: string;
  providerBillId: string;
  ewbNumber: string;
  status: EwbStatus;
  generatedAt: string;
  validUntil: string;
  validityDays: number;
  lastVerifiedAt: string;
  verificationSource: string;
  sellerName: string;
  sellerGstin: string;
  buyerName: string;
  buyerGstin: string;
  fromState: string;
  toState: string;
  totals: { taxable: number; tax: number; total: number };
  lines: { description: string; hsn: string; quantity: string; unit: string; taxablePaise: number; taxRate: number }[];
  transport: { transporterName: string; transporterId: string; vehicleNumber: string; mode: string; distanceKm: string; docNumber?: string; docDate?: string };
  history: { at: string; action: string; detail: string }[];
  cancelledAt?: string;
  cancelReason?: string;
  consolidatedInto?: string;
  extensionCount: number;
  /** Recorded by the server for the printed bill (EWB-01); absent on older bills. */
  documentType?: string;
  transactionType?: number;
  dispatch?: { place: string; state: string; pincode: string };
  delivery?: { place: string; state: string; pincode: string };
  nicDistanceKm?: number;
};

export type GstSnapshot = {
  id: string;
  gstin: string;
  returnType: 'GSTR-1' | 'GSTR-2B' | 'GSTR-3B';
  period: string;
  providerStatus: 'filed' | 'not_filed' | 'in_progress' | 'not_available';
  filedOn?: string;
  dueDate?: string;
  arn?: string;
  checkedAt: string;
  source: string;
};

export const templates = [
  { id: 'classic', name: 'Classic', note: 'Balanced, familiar layout', icon: 'file-text', accent: '#175b42' },
  { id: 'compact', name: 'Compact', note: 'More room for line items', icon: 'list', accent: '#2d5f8a' },
  { id: 'tax-summary', name: 'Tax summary', note: 'HSN-wise tax breakdown', icon: 'percent', accent: '#7a4d12' },
  { id: 'service', name: 'Services', note: 'SAC codes, hours & fees', icon: 'briefcase', accent: '#5b3f8c' },
  { id: 'dispatch', name: 'Dispatch', note: 'Transport details up front', icon: 'truck', accent: '#8a3b2e' },
  { id: 'minimal', name: 'Minimal', note: 'Focused on essentials', icon: 'minus-square', accent: '#3c4a43' },
] as const;
export type TemplateId = (typeof templates)[number]['id'];

export const STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu and Kashmir' }, { code: '02', name: 'Himachal Pradesh' }, { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' }, { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' }, { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' }, { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' }, { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' }, { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' }, { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' }, { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' }, { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' }, { code: '30', name: 'Goa' }, { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' }, { code: '33', name: 'Tamil Nadu' }, { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' }, { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' }, { code: '38', name: 'Ladakh' }, { code: '97', name: 'Other Territory' },
];

// 40% applies from 22 Sep 2025; 12% and 28% remain for some goods.
export const GST_RATES = [0, 3, 5, 12, 18, 28, 40];
export const UNITS = ['Nos', 'Kgs', 'Mtr', 'Ltr', 'Box', 'Pcs', 'Set', 'Ton', 'Hrs', 'OTH'];
export const TRANSPORT_MODES = ['Road', 'Rail', 'Air', 'Ship'];
export const CANCEL_REASONS = ['Duplicate', 'Order cancelled', 'Data entry mistake', 'Others'];
export const VEHICLE_REASONS = ['Breakdown', 'Transhipment', 'First time', 'Others'];
export const EXTEND_REASONS = ['Natural calamity', 'Law and order situation', 'Transhipment', 'Accident', 'Others'];

export function uid(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function stateByName(name: string) {
  const clean = name.trim().toLowerCase();
  return STATES.find((state) => state.name.toLowerCase() === clean);
}

export function stateForGstin(gstin: string) {
  return STATES.find((state) => state.code === gstin.slice(0, 2));
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function gstinProblem(raw: string): string | null {
  const gstin = raw.trim().toUpperCase();
  if (!gstin) return null;
  if (!/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/.test(gstin)) return 'Use the 15-character format, e.g. 27AAPFU0939F1ZV.';
  if (!stateForGstin(gstin)) return 'Starts with an unknown state code.';
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const product = GSTIN_CHARS.indexOf(gstin[index]!) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  if (GSTIN_CHARS[(36 - (sum % 36)) % 36] !== gstin[14]) return 'Check digit does not match — re-check each character.';
  return null;
}

export const VEHICLE_PATTERN = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2}|TR[A-Z0-9]{6,12})$/;

export function today() {
  const now = new Date(Date.now() + 5.5 * 3_600_000);
  return now.toISOString().slice(0, 10);
}

export function newLine(templateId = 'classic'): InvoiceLine {
  return { id: uid('l'), description: '', hsn: '', quantity: '1', unit: templateId === 'service' ? 'OTH' : 'Nos', taxablePaise: 0, taxRate: 18 };
}

export function newInvoice(templateId = 'classic'): Invoice {
  const now = new Date().toISOString();
  return {
    id: uid('inv_'),
    invoiceNumber: '',
    invoiceDate: today(),
    documentType: 'Tax invoice',
    sellerName: '',
    sellerGstin: '',
    sellerAddress: '',
    sellerState: '',
    sellerPincode: '',
    dispatchFrom: '',
    dispatchState: '',
    dispatchPincode: '',
    buyerName: '',
    buyerGstin: '',
    buyerAddress: '',
    buyerState: '',
    buyerPincode: '',
    shipTo: '',
    shipToState: '',
    shipToPincode: '',
    placeOfSupply: '',
    supplyType: 'intra',
    lines: [newLine(templateId)],
    transporterName: '',
    transporterId: '',
    vehicleNumber: '',
    transportMode: 'Road',
    distanceKm: '',
    transportDocNo: '',
    transportDocDate: '',
    vehicleType: 'regular',
    notes: '',
    templateId,
    templateVersion: 1,
    schemaVersion: 2,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    revisionHistory: [],
  };
}

/** Fills fields added in later schema versions so older saved drafts keep working. */
export function migrateInvoice(raw: Partial<Invoice> & { id: string }): Invoice {
  const base = newInvoice(raw.templateId);
  return { ...base, ...raw, lines: raw.lines?.length ? raw.lines : base.lines, revisionHistory: raw.revisionHistory ?? [], schemaVersion: 2 };
}

export function parseRupees(value: string) {
  const number = Number(value.replace(/[,₹\s]/g, '').trim());
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

export function paiseToInput(paise: number) {
  if (!paise) return '';
  return (paise / 100).toFixed(2).replace(/\.00$/, '');
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });

export function formatInr(paise: number, compact = false) {
  return (compact ? inrCompact : inr).format(paise / 100);
}

export function formatDate(iso: string, withTime = false) {
  if (!iso) return '—';
  const date = iso.length === 10 ? new Date(`${iso}T00:00:00+05:30`) : new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

export function relativeTime(iso: string) {
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return '—';
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return minutes > 0 ? `${minutes} min ago` : `in ${-minutes} min`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return hours > 0 ? `${hours} h ago` : `in ${-hours} h`;
  const days = Math.round(hours / 24);
  return days > 0 ? `${days} d ago` : `in ${-days} d`;
}

/** Taxable value of quantity × rate less the discount (never below zero). */
export function lineTaxable(quantity: string, unitPricePaise: number, discountPaise = 0) {
  return Math.max(0, Math.round((Number(quantity) || 0) * unitPricePaise) - discountPaise);
}

/** Has the user filled any part of a "dispatch from" / "ship to" place? */
export function hasDispatch(invoice: Invoice) {
  return Boolean(invoice.dispatchFrom.trim() || invoice.dispatchState || invoice.dispatchPincode.trim());
}
export function hasShipTo(invoice: Invoice) {
  return Boolean(invoice.shipTo.trim() || invoice.shipToState || invoice.shipToPincode.trim());
}

/** PIN codes the goods move between: dispatch place → delivery place, else seller → buyer. */
export function routePins(invoice: Invoice) {
  return {
    from: (hasDispatch(invoice) ? invoice.dispatchPincode : invoice.sellerPincode).trim(),
    to: (hasShipTo(invoice) ? invoice.shipToPincode : invoice.buyerPincode).trim(),
  };
}

export function lineTax(line: InvoiceLine) {
  return Math.round((line.taxablePaise * line.taxRate) / 100);
}

export function invoiceTotals(invoice: Pick<Invoice, 'lines' | 'supplyType'>) {
  const taxable = invoice.lines.reduce((sum, line) => sum + line.taxablePaise, 0);
  const tax = invoice.lines.reduce((sum, line) => sum + lineTax(line), 0);
  const halfTax = invoice.supplyType === 'intra' ? Math.round(tax / 2) : 0;
  return {
    taxable,
    tax,
    cgst: halfTax,
    sgst: invoice.supplyType === 'intra' ? tax - halfTax : 0,
    igst: invoice.supplyType === 'inter' ? tax : 0,
    total: taxable + tax,
  };
}

/** Same-state seller and receiver means CGST + SGST; otherwise IGST. */
export function expectedSupplyType(invoice: Pick<Invoice, 'sellerState' | 'buyerState'>): SupplyType | null {
  const seller = stateByName(invoice.sellerState);
  const buyer = stateByName(invoice.buyerState);
  if (!seller || !buyer) return null;
  return seller.code === buyer.code ? 'intra' : 'inter';
}

export type FieldKey = keyof Invoice | `line.${string}.${keyof InvoiceLine}` | 'lines';
export type Section = 'seller' | 'buyer' | 'invoice' | 'items' | 'transport';
export type Issue = { field: string; section: Section; message: string };

/** Invoice completeness (needed to save as "Ready"). */
/** Another saved invoice with this number for the same buyer, even one whose number was released. */
function sameBuyerAndNumber(invoice: Invoice, others: Invoice[]) {
  const number = invoice.invoiceNumber.trim().toLowerCase();
  const buyer = invoice.buyerName.trim().toLowerCase();
  if (!number || !buyer) return false;
  return others.some((other) => other.id !== invoice.id && !other.unsaved
    && other.sellerGstin.toUpperCase() === invoice.sellerGstin.toUpperCase()
    && other.invoiceNumber.trim().toLowerCase() === number
    && other.buyerName.trim().toLowerCase() === buyer);
}

/** `released`: invoices whose number may be used again (their e-way bill was cancelled). */
export function invoiceIssues(invoice: Invoice, all: Invoice[] = [], released: Set<string> = new Set()): Issue[] {
  const issues: Issue[] = [];
  const add = (section: Section, field: string, message: string) => issues.push({ section, field, message });
  // Sales are numbered in your series, one per document type; a purchase keeps the number on the party's bill.
  const purchase = isPurchase(invoice);
  const others = all.filter((other) => isPurchase(other) === purchase && (purchase || sameDocumentType(other, invoice.documentType)));
  if (!invoice.sellerName.trim()) add('seller', 'sellerName', 'Seller name is required.');
  // An unregistered seller (a party on a purchase, or your own unregistered business)
  // has no GSTIN; the e-way bill needs one (transportIssues).
  if (invoice.sellerGstin.trim()) {
    const problem = gstinProblem(invoice.sellerGstin);
    if (problem) add('seller', 'sellerGstin', problem);
  }
  const sellerState = stateByName(invoice.sellerState);
  if (!sellerState) add('seller', 'sellerState', 'Choose the seller state.');
  else if (invoice.sellerGstin.length === 15 && !gstinProblem(invoice.sellerGstin) && invoice.sellerGstin.slice(0, 2) !== sellerState.code) {
    add('seller', 'sellerState', `GSTIN belongs to ${stateForGstin(invoice.sellerGstin)?.name}.`);
  }
  if ((!purchase || invoice.sellerPincode.trim()) && !/^[1-9]\d{5}$/.test(invoice.sellerPincode.trim())) add('seller', 'sellerPincode', 'Enter the 6-digit PIN code.');

  if (!invoice.buyerName.trim()) add('buyer', 'buyerName', 'Receiver name is required.');
  const buyerProblem = invoice.buyerGstin.trim().toUpperCase() === 'URP' ? null : gstinProblem(invoice.buyerGstin);
  if (buyerProblem) add('buyer', 'buyerGstin', buyerProblem);
  if (!stateByName(invoice.buyerState)) add('buyer', 'buyerState', 'Choose the receiver state.');
  if (!/^[1-9]\d{5}$/.test(invoice.buyerPincode.trim())) add('buyer', 'buyerPincode', 'Enter the 6-digit PIN code.');
  if (hasDispatch(invoice)) {
    if (!stateByName(invoice.dispatchState)) add('seller', 'dispatchState', 'Choose the dispatch state.');
    if (!/^[1-9]\d{5}$/.test(invoice.dispatchPincode.trim())) add('seller', 'dispatchPincode', 'Enter the 6-digit dispatch PIN code.');
  }
  if (hasShipTo(invoice)) {
    if (!stateByName(invoice.shipToState)) add('buyer', 'shipToState', 'Choose the delivery state.');
    if (!/^[1-9]\d{5}$/.test(invoice.shipToPincode.trim())) add('buyer', 'shipToPincode', 'Enter the 6-digit delivery PIN code.');
  }

  if (!invoice.invoiceNumber.trim()) add('invoice', 'invoiceNumber', 'Invoice number is required.');
  else if (!/^[A-Za-z0-9/-]{1,16}$/.test(invoice.invoiceNumber.trim())) add('invoice', 'invoiceNumber', 'Use up to 16 letters, digits, / or -.');
  else if (!purchase && invoiceSeriesProblem(invoice, others, released)) add('invoice', 'invoiceNumber', invoiceSeriesProblem(invoice, others, released)!.message);
  else if (sameBuyerAndNumber(invoice, others)) add('invoice', 'invoiceNumber', `Invoice ${invoice.invoiceNumber.trim()} for ${invoice.buyerName.trim()} already exists. Open it from the invoice list instead.`);
  else if (others.some((other) => other.id !== invoice.id && !other.unsaved && !released.has(other.id) && other.invoiceNumber.trim().toLowerCase() === invoice.invoiceNumber.trim().toLowerCase() && other.sellerGstin.toUpperCase() === invoice.sellerGstin.toUpperCase())) {
    add('invoice', 'invoiceNumber', purchase ? 'A purchase with this bill number from this party is already saved.' : `This number is already used for a ${invoice.documentType.toLowerCase()} of this GSTIN.`);
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(invoice.invoiceDate) && !Number.isNaN(Date.parse(invoice.invoiceDate)) && new Date(`${invoice.invoiceDate}T00:00:00Z`).toISOString().slice(0, 10) === invoice.invoiceDate;
  if (!validDate) add('invoice', 'invoiceDate', 'Use the format YYYY-MM-DD.');
  else if (invoice.invoiceDate > today()) add('invoice', 'invoiceDate', 'Invoice date cannot be in the future.');
  const expected = expectedSupplyType(invoice);
  if (expected && expected !== invoice.supplyType) add('invoice', 'supplyType', expected === 'intra' ? 'Same state — use Within state.' : 'Different states — use Inter-state.');

  const filled = invoice.lines.filter((line) => line.description.trim() || line.taxablePaise > 0);
  if (!filled.some((line) => line.description.trim() && line.taxablePaise > 0)) add('items', 'lines', 'Add at least one product with a value.');
  invoice.lines.forEach((line) => {
    if (!line.description.trim() && !line.taxablePaise) return;
    if (!line.description.trim()) add('items', `line.${line.id}.description`, 'Describe this product.');
    if (!/^\d{4}(\d{2})?(\d{2})?$/.test(line.hsn.trim())) add('items', `line.${line.id}.hsn`, 'HSN/SAC must be 4, 6 or 8 digits.');
    if (!(Number(line.quantity) > 0)) add('items', `line.${line.id}.quantity`, 'Quantity must be more than 0.');
    if (!line.taxablePaise) add('items', `line.${line.id}.taxablePaise`, 'Enter the taxable amount.');
  });
  return issues;
}

/** Additional transport rules required for an e-way bill. */
export function transportIssues(invoice: Invoice): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string, message: string) => issues.push({ section: 'transport', field, message });
  if (!invoice.sellerGstin.trim()) issues.push({ section: 'seller', field: 'sellerGstin', message: 'Seller GSTIN is required for an e-way bill.' });
  const distance = Number(invoice.distanceKm);
  if (!Number.isInteger(distance) || distance < 1 || distance > 4000) add('distanceKm', 'Distance must be 1–4000 km.');
  const vehicle = invoice.vehicleNumber.replace(/[\s-]/g, '').toUpperCase();
  if (invoice.transporterId.trim()) {
    const problem = gstinProblem(invoice.transporterId);
    if (problem) add('transporterId', problem);
  }
  if (invoice.transportMode === 'Road') {
    if (!vehicle && !invoice.transporterId.trim()) add('vehicleNumber', 'Add a vehicle number or transporter ID.');
    else if (vehicle && !VEHICLE_PATTERN.test(vehicle)) add('vehicleNumber', 'Format looks wrong (e.g. MH12AB1234).');
  } else {
    if (!invoice.transportDocNo.trim()) add('transportDocNo', `${invoice.transportMode} needs a transport document number.`);
    if (!invoice.transportDocDate.trim()) add('transportDocDate', 'Add the transport document date.');
  }
  return issues;
}

export function toEwbInput(invoice: Invoice) {
  const totals = invoiceTotals(invoice);
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber.trim(),
    invoiceDate: invoice.invoiceDate,
    documentType: invoice.documentType,
    supplyType: invoice.supplyType,
    seller: { name: invoice.sellerName.trim(), gstin: invoice.sellerGstin.trim(), address: invoice.sellerAddress.trim(), state: invoice.sellerState, pincode: invoice.sellerPincode.trim() },
    buyer: { name: invoice.buyerName.trim(), gstin: invoice.buyerGstin.trim(), address: invoice.buyerAddress.trim(), state: invoice.buyerState, pincode: invoice.buyerPincode.trim() },
    ...(hasDispatch(invoice) ? { dispatch: { address: invoice.dispatchFrom.trim() || invoice.sellerAddress.trim(), state: invoice.dispatchState, pincode: invoice.dispatchPincode.trim() } } : {}),
    ...(hasShipTo(invoice) ? { shipTo: { address: invoice.shipTo.trim() || invoice.buyerAddress.trim(), state: invoice.shipToState, pincode: invoice.shipToPincode.trim() } } : {}),
    lines: invoice.lines
      .filter((line) => line.description.trim() && line.taxablePaise > 0)
      .map(({ description, hsn, quantity, unit, taxablePaise, taxRate }) => ({ description: description.trim(), hsn: hsn.trim(), quantity, unit, taxablePaise, taxRate })),
    transport: {
      transporterName: invoice.transporterName.trim(),
      transporterId: invoice.transporterId.trim(),
      vehicleNumber: invoice.vehicleNumber.trim(),
      mode: invoice.transportMode,
      distanceKm: invoice.distanceKm.trim(),
      docNumber: invoice.transportDocNo.trim() || undefined,
      docDate: invoice.transportDocDate.trim() || undefined,
      vehicleType: invoice.vehicleType,
    },
    totals: { taxable: totals.taxable, tax: totals.tax, total: totals.total },
  };
}

export function ewbStatusMeta(status: EwbStatus | string): { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' } {
  switch (status) {
    // Part-B is usually filled by the transporter on the portal, so a bill without it is shown as active.
    case 'active':
    case 'part_b_pending': return { label: 'Active', tone: 'green' };
    case 'expired': return { label: 'Expired', tone: 'neutral' };
    case 'cancelled': return { label: 'Cancelled', tone: 'red' };
    default: return { label: 'Verification unavailable', tone: 'neutral' };
  }
}

/** Status computed locally from cached data; labelled as cached by the UI. */
export function liveEwbStatus(ewb: EwbRecord, now = Date.now()): EwbStatus {
  if (ewb.status === 'cancelled') return 'cancelled';
  if (now > Date.parse(ewb.validUntil)) return 'expired';
  return ewb.status;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number) {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number) {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return [hundred ? `${ONES[hundred]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Indian numbering (lakh / crore), e.g. 118000.50 → "One Lakh Eighteen Thousand Rupees and Fifty Paise Only". */
export function amountInWords(paise: number) {
  let rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  if (rupees === 0 && remainder === 0) return 'Zero Rupees Only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000); rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000); rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rupees) parts.push(belowThousand(rupees));
  const words = parts.join(' ');
  return `${words ? `${words} Rupees` : ''}${remainder ? `${words ? ' and ' : ''}${belowHundred(remainder)} Paise` : ''} Only`;
}

/** Text before the last run of digits, the digits, and the text after them: "INV/26-27/005" → "INV/26-27/", "005", "". */
const NUMBERED = /^(.*?)(\d+)(\D*)$/;

/**
 * Invoices whose e-way bill was cancelled (and not generated again) give
 * their number back, so the next invoice can use it.
 */
export function releasedInvoiceIds(invoices: Invoice[], ewbs: EwbRecord[]) {
  const cancelled = new Set(ewbs.filter((ewb) => ewb.status === 'cancelled').map((ewb) => ewb.invoiceId));
  return new Set(invoices.filter((invoice) => invoice.status !== 'ewb_generated' && cancelled.has(invoice.id)).map((invoice) => invoice.id));
}

/**
 * The number after the latest invoice's, in the same style: INV-001 → INV-002,
 * GR-01 → GR-02, gr-1 → gr-2, INV/26-27/009 → INV/26-27/010. Empty for the
 * first invoice, which the user numbers. Deleted invoices and invoices whose
 * e-way bill was cancelled (`released`) do not count, so their number is used again.
 */
/**
 * The invoice whose number sets the series: the newest one made in the app. A PDF
 * import (often someone else's bill, "55" among FY26-27/306…) sets it only when
 * no invoice was made in the app; it still counts toward the highest number.
 */
function latestOfSeries(counted: Invoice[]) {
  const made = counted.filter((invoice) => !invoice.sourceFileName);
  return [...(made.length ? made : counted)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Series of an invoice number: everything except its last run of digits ("INV-05" and "inv-12" share one). */
function seriesOf(invoiceNumber: string) {
  const match = NUMBERED.exec(invoiceNumber.trim());
  return match ? `${match[1]!.toLowerCase()}#${match[3]!.toLowerCase()}` : null;
}

/** Same document type (Tax invoice, Bill of supply, …), ignoring case; older invoices without one are tax invoices. */
export function sameDocumentType(invoice: Pick<Invoice, 'documentType'>, documentType: string) {
  return (invoice.documentType || 'Tax invoice').trim().toLowerCase() === (documentType || 'Tax invoice').trim().toLowerCase();
}

/**
 * When the number does not follow the series of the GSTIN's latest invoice of the
 * same document type (e.g. GR-01 after INV-05): the message and the number that would follow.
 * Each document type has its own series.
 */
export function invoiceSeriesProblem(invoice: Invoice, others: Invoice[], released: Set<string> = new Set()) {
  // An invoice imported from a PDF keeps the number printed on it, as does a purchase.
  if (invoice.sourceFileName || isPurchase(invoice)) return null;
  const counted = others.filter((other) => other.id !== invoice.id && !isPurchase(other) && sameDocumentType(other, invoice.documentType) && !other.unsaved && !released.has(other.id) && other.invoiceNumber.trim() && sameSeller(other, invoice.sellerGstin));
  const latest = latestOfSeries(counted);
  if (!latest || !invoice.invoiceNumber.trim()) return null;
  const expected = seriesOf(latest.invoiceNumber);
  if (!expected || seriesOf(invoice.invoiceNumber) === expected) return null;
  const next = nextInvoiceNumber(counted);
  const type = invoice.documentType.toLowerCase();
  return { next, latest: latest.invoiceNumber, message: `Number does not follow your last ${type} ${latest.invoiceNumber}. The next number is ${next}.` };
}

/** What the invoice list shows about the e-way bill. */
export function invoiceEwbMeta(invoice: Invoice): { label: string; tone: 'green' | 'amber' | 'neutral'; icon: 'check' | 'file-text' | 'edit-3' } {
  if (isPurchase(invoice)) return invoice.status === 'draft' ? { label: 'Draft · not saved yet', tone: 'neutral', icon: 'edit-3' } : { label: 'Purchase saved', tone: 'green', icon: 'check' };
  if (invoice.status === 'ewb_generated') return { label: 'EWB generated', tone: 'green', icon: 'check' };
  if (invoice.status === 'draft') return { label: 'Draft · not saved yet', tone: 'neutral', icon: 'edit-3' };
  if (invoice.ewbRequired === false) return { label: 'EWB not required', tone: 'neutral', icon: 'file-text' };
  return { label: 'EWB pending', tone: 'amber', icon: 'file-text' };
}

export function nextInvoiceNumber(invoices: Invoice[], released: Set<string> = new Set()) {
  const counted = invoices.filter((invoice) => invoice.invoiceNumber.trim() && !invoice.unsaved && !released.has(invoice.id));
  const latest = latestOfSeries(counted);
  const match = latest ? NUMBERED.exec(latest.invoiceNumber.trim()) : null;
  if (!match) return '';
  const [, prefix, digits, suffix] = match as unknown as [string, string, string, string];
  let max = 0;
  for (const invoice of counted) {
    const other = NUMBERED.exec(invoice.invoiceNumber.trim());
    if (other && other[1]!.toLowerCase() === prefix.toLowerCase() && other[3]!.toLowerCase() === suffix.toLowerCase()) max = Math.max(max, Number(other[2]));
  }
  return `${prefix}${String(max + 1).padStart(digits.length, '0')}${suffix}`;
}

/** Invoice belongs to this GSTIN (case-insensitive); invoices without a seller GSTIN count for every registration, as in the invoice list. */
function sameSeller(invoice: Invoice, gstin: string) {
  return !invoice.sellerGstin.trim() || !gstin.trim() || invoice.sellerGstin.trim().toUpperCase() === gstin.trim().toUpperCase();
}

/** Number for the next invoice of one GSTIN and document type, continuing that series. */
export function nextNumberForSeller(invoices: Invoice[], gstin: string, ewbs: EwbRecord[] = [], documentType = 'Tax invoice') {
  const sellerInvoices = invoices.filter((invoice) => !isPurchase(invoice) && sameDocumentType(invoice, documentType) && sameSeller(invoice, gstin));
  return nextInvoiceNumber(sellerInvoices, releasedInvoiceIds(sellerInvoices, ewbs));
}

/** Return period for GST: `YYYY-MM`. Returns are filed for the previous month. */
/** Indian financial year (1 April – 31 March) containing `date` (YYYY-MM-DD, IST). */
export function financialYear(date = today()) {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? year : year - 1;
  return { label: `FY ${start}-${String(start + 1).slice(2)}`, from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** IST calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function istDate(iso: string) {
  return new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

export function previousPeriod(offset = 1, from = new Date()) {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - offset, 1));
  return date.toISOString().slice(0, 7);
}

export function periodLabel(period: string) {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const GST_STATUS_META: Record<GstSnapshot['providerStatus'], { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  filed: { label: 'Filed', tone: 'green' },
  in_progress: { label: 'In progress', tone: 'amber' },
  not_filed: { label: 'Not filed', tone: 'red' },
  not_available: { label: 'Not available', tone: 'neutral' },
};

/** New draft prefilled with seller details for the selected GST registration. */
export function draftForBusiness(business: Business, activeGstin: string, invoices: Invoice[], templateId?: string, ewbs: EwbRecord[] = []): Invoice {
  const template = templates.some((item) => item.id === templateId) ? templateId! : business.defaultTemplateId ?? 'classic';
  const gstin = activeGstin || business.gstin;
  const registration = business.gstRegistrations?.find((item) => item.gstin === gstin);
  return {
    ...newInvoice(template),
    invoiceNumber: nextNumberForSeller(invoices, gstin, ewbs),
    sellerName: business.name,
    sellerGstin: gstin,
    sellerAddress: business.address,
    sellerState: registration?.state || business.state,
    sellerPincode: business.pincode ?? '',
    bank: defaultBank(business) ? invoiceBank(defaultBank(business)!) : null,
    unsaved: true,
  };
}

/** New purchase entry: the party is the seller (filled in by the user), you are the buyer. */
export function purchaseDraft(business: Business, activeGstin: string): Invoice {
  const gstin = activeGstin || business.gstin;
  const registration = business.gstRegistrations?.find((item) => item.gstin === gstin);
  const state = registration?.state || business.state;
  return {
    ...newInvoice('classic'),
    kind: 'purchase',
    buyerName: business.name,
    buyerGstin: gstin,
    buyerAddress: business.address,
    buyerState: state,
    buyerPincode: business.pincode ?? '',
    placeOfSupply: state,
    bank: null,
    ewbRequired: false,
    unsaved: true,
  };
}
