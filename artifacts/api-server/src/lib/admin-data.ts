import { directory, type DirectoryUser } from "./admin-directory";
import { listWorkspaceIds, peekWorkspace, queryLogs, readDoc, type CreditPurchase, type EwbRecord, type LogRecord, type WalletEntry, type Workspace } from "./store";
import { suspendedAccounts } from "./suspensions";

/**
 * Platform-wide views for the admin panel, built from the real records:
 * accounts from Firebase Authentication, and each workspace (wallet, ledger,
 * purchases, e-way bills, business profile) from the store. Built at most
 * once a minute per server instance and shared by all admin screens.
 *
 * Scale: one pass reads every workspace and its e-way bills. That suits
 * thousands of accounts; beyond that, move these totals to counters kept at
 * write time (see docs/ADMIN.md).
 */

export type UserRow = {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  disabled: boolean;
  suspended: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  adminRole: string | null;
  hasWorkspace: boolean;
  businessName: string | null;
  gstin: string | null;
  balance: number;
  heldCredits: number;
  purchasedCredits: number;
  grantedCredits: number;
  adjustedCredits: number;
  consumedCredits: number;
  paidPayments: number;
  paidPaise: number;
  pendingPayments: number;
  ewbTotal: number;
  ewbActive: number;
  ewbCancelled: number;
  lastActivityAt: string | null;
  planId: string;
  planState: string;
};

export type EwbRow = {
  id: string;
  uid: string;
  ewbNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  generatedAt: string;
  validUntil: string;
  status: string;
  provider: string;
  buyerName: string;
  sellerName: string;
  sellerGstin: string;
  totalPaise: number;
  creditsCharged: number;
  cancelledAt: string | null;
  consolidatedInto: string | null;
};

export type PurchaseRow = CreditPurchase & { uid: string };
export type LedgerRow = WalletEntry & { uid: string };

export type Snapshot = {
  builtAt: string;
  users: UserRow[];
  ewbs: EwbRow[];
  purchases: PurchaseRow[];
  ledger: LedgerRow[];
  /** The ledger is trimmed to the last 1,000 entries per account; true when some account hit that. */
  ledgerTrimmed: boolean;
  workspaces: Map<string, Workspace>;
};

const TTL_MS = 60_000;
let cached: { snapshot: Snapshot; at: number } | null = null;
let building: Promise<Snapshot> | null = null;

export function invalidateSnapshot() {
  cached = null;
}

const liveStatus = (ewb: EwbRecord, now = Date.now()) => (ewb.status !== "cancelled" && now > Date.parse(ewb.validUntil) ? "expired" : ewb.status);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  }));
  return out;
}

async function build(): Promise<Snapshot> {
  const [accounts, ids, suspended] = await Promise.all([directory().list(), listWorkspaceIds(), suspendedAccounts()]);
  const workspaces = new Map<string, Workspace>();
  const loaded = await mapLimit(ids, 10, (id) => peekWorkspace(id, { ewbs: true, syncKeys: ["business/profile"] }));
  loaded.forEach((workspace, index) => { if (workspace) workspaces.set(ids[index]!, workspace); });

  const byUid = new Map<string, DirectoryUser>(accounts.map((account) => [account.uid, account]));
  const uids = [...new Set([...byUid.keys(), ...workspaces.keys()])];
  const ewbs: EwbRow[] = [];
  const purchases: PurchaseRow[] = [];
  const ledger: LedgerRow[] = [];
  let ledgerTrimmed = false;

  const users = uids.map((uid): UserRow => {
    const account = byUid.get(uid);
    const workspace = workspaces.get(uid);
    const entries = workspace?.wallet.ledger ?? [];
    if (entries.length >= 1000) ledgerTrimmed = true;
    const sum = (filter: (entry: WalletEntry) => boolean) => entries.filter(filter).reduce((total, entry) => total + entry.credits, 0);
    const chargedFor = new Map<string, number>();
    for (const entry of entries) {
      ledger.push({ ...entry, uid });
      if (entry.status === "charged" && entry.kind === "generate" && entry.targetId) chargedFor.set(entry.targetId, (chargedFor.get(entry.targetId) ?? 0) - entry.credits);
    }
    const own = Object.values(workspace?.ewbs ?? {});
    for (const ewb of own) {
      ewbs.push({
        id: ewb.id, uid, ewbNumber: ewb.ewbNumber, invoiceId: ewb.invoiceId, invoiceNumber: ewb.invoiceNumber, invoiceDate: ewb.invoiceDate,
        generatedAt: ewb.generatedAt, validUntil: ewb.validUntil, status: liveStatus(ewb), provider: ewb.provider, buyerName: ewb.buyerName,
        sellerName: ewb.sellerName, sellerGstin: ewb.sellerGstin, totalPaise: ewb.totals.total, creditsCharged: chargedFor.get(ewb.id) ?? 0,
        cancelledAt: ewb.cancelledAt ?? null, consolidatedInto: ewb.consolidatedInto ?? null,
      });
    }
    const ownPurchases = Object.values(workspace?.purchases ?? {});
    for (const purchase of ownPurchases) purchases.push({ ...purchase, uid });
    const paid = ownPurchases.filter((purchase) => purchase.status === "paid" && purchase.provider === "razorpay");
    const business = workspace?.sync["business"]?.["profile"]?.data as { name?: string; gstin?: string } | undefined;
    const activity = [account?.lastSignInAt, ...own.map((ewb) => ewb.updatedAt), entries.at(-1)?.at].filter(Boolean) as string[];
    return {
      uid,
      email: account?.email ?? null,
      name: account?.name ?? null,
      emailVerified: account?.emailVerified ?? false,
      disabled: account?.disabled ?? false,
      suspended: uid in suspended,
      createdAt: account?.createdAt ?? workspace?.createdAt ?? null,
      lastSignInAt: account?.lastSignInAt ?? null,
      adminRole: account?.adminRole ?? null,
      hasWorkspace: Boolean(workspace),
      businessName: business?.name ?? null,
      gstin: business?.gstin ?? null,
      balance: workspace?.wallet.balance ?? 0,
      heldCredits: -sum((entry) => entry.status === "held"),
      purchasedCredits: sum((entry) => entry.kind === "topup" && entry.status === "credited"),
      grantedCredits: sum((entry) => entry.kind === "grant" && entry.status === "credited"),
      adjustedCredits: sum((entry) => entry.kind === "adjust"),
      consumedCredits: -sum((entry) => entry.status === "charged"),
      paidPayments: paid.length,
      paidPaise: paid.reduce((total, purchase) => total + purchase.amountPaise, 0),
      pendingPayments: ownPurchases.filter((purchase) => purchase.status === "created").length,
      ewbTotal: own.length,
      ewbActive: own.filter((ewb) => ["active", "part_b_pending"].includes(liveStatus(ewb))).length,
      ewbCancelled: own.filter((ewb) => ewb.status === "cancelled").length,
      lastActivityAt: activity.sort().at(-1) ?? null,
      planId: workspace?.subscription.planId ?? "free",
      planState: workspace?.subscription.entitlementState ?? "trial",
    };
  });

  return { builtAt: new Date().toISOString(), users, ewbs, purchases, ledger, ledgerTrimmed, workspaces };
}

/** The shared snapshot; `fresh` rebuilds it now. */
export async function snapshot(fresh = false): Promise<Snapshot> {
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;
  building ??= build().then((result) => {
    cached = { snapshot: result, at: Date.now() };
    return result;
  }).finally(() => { building = null; });
  return building;
}

/* ---------- Periods and series ---------- */

export type Range = { from: string; to: string };

/** YYYY-MM-DD in India time. */
export function istDay(iso: string) {
  return new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

export const inRange = (iso: string | null | undefined, range: Range) => Boolean(iso) && iso! >= range.from && iso! <= range.to;

function daysOf(range: Range) {
  const days: string[] = [];
  const end = istDay(range.to);
  let day = istDay(range.from);
  for (let guard = 0; day <= end && guard < 400; guard++) {
    days.push(day);
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return days;
}

function series(range: Range, items: { at: string; value: number }[]) {
  const totals = new Map(daysOf(range).map((day) => [day, 0]));
  for (const item of items) {
    const day = istDay(item.at);
    if (totals.has(day)) totals.set(day, totals.get(day)! + item.value);
  }
  return [...totals.entries()].map(([day, value]) => ({ day, value }));
}

/* ---------- API usage ---------- */

export const API_LOG_CAP = 20_000;

export async function apiCalls(range: Range) {
  const records = await queryLogs("api_calls", { ...range, limit: API_LOG_CAP });
  return { records, capped: records.length >= API_LOG_CAP };
}

export function summarizeApi(records: LogRecord[]) {
  const durations = records.map((record) => Number(record["durationMs"] ?? 0)).sort((a, b) => a - b);
  const pct = (p: number) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))]! : null);
  const count = (outcome: string) => records.filter((record) => record["outcome"] === outcome).length;
  const group = (key: string) => {
    const map = new Map<string, { total: number; ok: number; failed: number; totalMs: number }>();
    for (const record of records) {
      const name = String(record[key] ?? "unknown");
      const entry = map.get(name) ?? { total: 0, ok: 0, failed: 0, totalMs: 0 };
      entry.total += 1;
      if (record["outcome"] === "ok") entry.ok += 1;
      else entry.failed += 1;
      entry.totalMs += Number(record["durationMs"] ?? 0);
      map.set(name, entry);
    }
    return [...map.entries()].map(([name, entry]) => ({ name, total: entry.total, ok: entry.ok, failed: entry.failed, avgMs: Math.round(entry.totalMs / entry.total) })).sort((a, b) => b.total - a.total);
  };
  const ok = count("ok");
  return {
    total: records.length,
    ok,
    failed: records.length - ok,
    timeouts: count("timeout"),
    network: count("network"),
    rateLimited: count("rate_limited"),
    authFailures: count("auth"),
    providerDown: count("provider_down"),
    rejected: count("rejected"),
    quotaErrors: count("quota"),
    testMode: records.filter((record) => record["testMode"] === true).length,
    errorRate: records.length ? (records.length - ok) / records.length : null,
    avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    p50Ms: pct(50),
    p95Ms: pct(95),
    byOperation: group("operation"),
    byProvider: group("provider"),
  };
}

export async function providerQuota() {
  return readDoc<{ provider: string; creditsRemaining: number; reportedAt: string; source: string }>("provider_status", "gstinapi");
}

/* ---------- App activity ---------- */

export const OPENS_LOG_CAP = 50_000;

/**
 * Daily active users (accounts that opened the app that day) and app opens per day,
 * from the `app_opens` log the app writes on each start, plus one row per active account.
 */
export async function activity(range: Range) {
  const [records, snap] = await Promise.all([queryLogs("app_opens", { ...range, limit: OPENS_LOG_CAP }), snapshot()]);
  const byDay = new Map(daysOf(range).map((day) => [day, { opens: 0, users: new Set<string>() }]));
  const byUser = new Map<string, { opens: number; days: Set<string>; firstAt: string; lastAt: string; platform: string; appVersion: string }>();
  for (const record of records) {
    const uid = String(record["workspaceId"] ?? "");
    if (!uid) continue;
    const day = istDay(record.at);
    const entry = byDay.get(day);
    if (entry) {
      entry.opens += 1;
      entry.users.add(uid);
    }
    const user = byUser.get(uid) ?? { opens: 0, days: new Set<string>(), firstAt: record.at, lastAt: record.at, platform: "", appVersion: "" };
    user.opens += 1;
    user.days.add(day);
    if (record.at <= user.firstAt) user.firstAt = record.at;
    // Records come newest first: the first one seen carries the latest platform and build.
    if (!user.platform) {
      user.platform = String(record["platform"] ?? "");
      user.appVersion = String(record["appVersion"] ?? "");
    }
    if (record.at >= user.lastAt) user.lastAt = record.at;
    byUser.set(uid, user);
  }
  const days = [...byDay.entries()].map(([day, entry]) => ({ day, activeUsers: entry.users.size, opens: entry.opens }));
  const today = istDay(new Date().toISOString());
  const todayRow = days.find((row) => row.day === today);
  const accounts = new Map(snap.users.map((user) => [user.uid, user]));
  const users = [...byUser.entries()].map(([uid, entry]) => {
    const account = accounts.get(uid);
    return {
      uid, email: account?.email ?? null, name: account?.name ?? null, businessName: account?.businessName ?? null, gstin: account?.gstin ?? null,
      opens: entry.opens, activeDays: entry.days.size, firstOpenAt: entry.firstAt, lastOpenAt: entry.lastAt, platform: entry.platform, appVersion: entry.appVersion,
    };
  }).sort((a, b) => b.lastOpenAt.localeCompare(a.lastOpenAt));
  const activeDays = days.filter((row) => row.activeUsers > 0);
  return {
    range,
    capped: records.length >= OPENS_LOG_CAP,
    summary: {
      activeToday: todayRow?.activeUsers ?? 0,
      opensToday: todayRow?.opens ?? 0,
      activeInRange: users.length,
      opensInRange: records.length,
      avgDailyActive: days.length ? Math.round((days.reduce((total, row) => total + row.activeUsers, 0) / days.length) * 10) / 10 : 0,
      avgOpensPerUserDay: activeDays.length ? Math.round((activeDays.reduce((total, row) => total + row.opens, 0) / activeDays.reduce((total, row) => total + row.activeUsers, 0)) * 10) / 10 : 0,
      peakDay: [...days].sort((a, b) => b.activeUsers - a.activeUsers)[0] ?? null,
    },
    days,
    activeSeries: days.map((row) => ({ day: row.day, value: row.activeUsers })),
    opensSeries: days.map((row) => ({ day: row.day, value: row.opens })),
    users,
  };
}

export type PaymentStepRow = { at: string; uid: string; email: string | null; name: string | null; step: string; credits: number | null; purchaseId: string | null; note: string | null; appVersion: string | null };
export type PaymentJourney = { lastStep: string; lastStepAt: string; checkouts: number; closedAtCheckout: number; paymentPages: number; cameBackUnpaid: number; cameBackPaid: number };

/**
 * Buying credits as the app reported it (the `payment_steps` log): each step with the
 * account's email, per payment link, per account, and how many reached each step.
 */
export async function paymentJourneys(range: Range) {
  const [records, snap] = await Promise.all([queryLogs("payment_steps", { ...range, limit: OPENS_LOG_CAP }), snapshot()]);
  const accounts = new Map(snap.users.map((user) => [user.uid, user]));
  const steps: PaymentStepRow[] = records.map((record) => {
    const uid = String(record["workspaceId"] ?? "");
    const account = accounts.get(uid);
    const value = (key: string) => (record[key] === undefined || record[key] === null ? null : String(record[key]));
    return { at: record.at, uid, email: account?.email ?? null, name: account?.name ?? null, step: String(record["step"] ?? ""), credits: typeof record["credits"] === "number" ? record["credits"] : null, purchaseId: value("purchaseId"), note: value("note"), appVersion: value("appVersion") };
  });
  const byPurchase = new Map<string, PaymentStepRow[]>();
  const byUser = new Map<string, PaymentJourney>();
  // Records come newest first: the first step seen for an account is its latest.
  for (const row of steps) {
    if (row.purchaseId) byPurchase.set(row.purchaseId, [...(byPurchase.get(row.purchaseId) ?? []), row]);
    const journey = byUser.get(row.uid) ?? { lastStep: row.step, lastStepAt: row.at, checkouts: 0, closedAtCheckout: 0, paymentPages: 0, cameBackUnpaid: 0, cameBackPaid: 0 };
    if (row.step === "checkout_opened") journey.checkouts += 1;
    if (row.step === "checkout_closed") journey.closedAtCheckout += 1;
    if (row.step === "payment_page_opened") journey.paymentPages += 1;
    if (row.step === "returned_unpaid") journey.cameBackUnpaid += 1;
    if (row.step === "returned_paid") journey.cameBackPaid += 1;
    byUser.set(row.uid, journey);
  }
  const count = (step: string) => steps.filter((row) => row.step === step).length;
  const accountsAt = (step: string) => new Set(steps.filter((row) => row.step === step).map((row) => row.uid)).size;
  return {
    capped: records.length >= OPENS_LOG_CAP,
    steps,
    byPurchase,
    byUser,
    summary: {
      walletOpens: count("wallet_opened"),
      checkouts: count("checkout_opened"),
      checkoutAccounts: accountsAt("checkout_opened"),
      closedAtCheckout: count("checkout_closed"),
      paymentPages: count("payment_page_opened"),
      cameBackUnpaid: count("returned_unpaid"),
      cameBackPaid: count("returned_paid"),
      errors: count("payment_error"),
    },
  };
}

/** What happened to a payment link, in words: from its status and the app's steps. */
export function paymentOutcome(purchase: Pick<CreditPurchase, "status">, steps: PaymentStepRow[] = []) {
  if (purchase.status === "paid") return "Paid";
  if (purchase.status === "expired") return "Expired unpaid";
  if (purchase.status === "cancelled") return "Cancelled";
  if (steps.some((row) => row.step === "returned_unpaid")) return "Came back without paying";
  if (steps.some((row) => row.step === "payment_page_opened")) return "On payment page (no result yet)";
  return "Link created";
}

/* ---------- Overview ---------- */

export async function overview(range: Range) {
  const snap = await snapshot();
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const today = istDay(new Date(now).toISOString());
  const users = snap.users;
  const { records, capped } = await apiCalls(range);
  const generateCalls = records.filter((record) => record["operation"] === "ewb_generate");
  const generated = snap.ewbs.filter((ewb) => inRange(ewb.generatedAt, range));
  const ledgerIn = snap.ledger.filter((entry) => inRange(entry.at, range));
  const sumCredits = (filter: (entry: LedgerRow) => boolean) => ledgerIn.filter(filter).reduce((total, entry) => total + entry.credits, 0);
  const real = snap.purchases.filter((purchase) => purchase.provider === "razorpay");
  const paidIn = real.filter((purchase) => purchase.status === "paid" && inRange(purchase.paidAt, range));
  const paidToday = real.filter((purchase) => purchase.status === "paid" && purchase.paidAt && istDay(purchase.paidAt) === today);

  return {
    range,
    builtAt: snap.builtAt,
    users: {
      total: users.length,
      verified: users.filter((user) => user.emailVerified).length,
      unverified: users.filter((user) => !user.emailVerified).length,
      suspended: users.filter((user) => user.suspended || user.disabled).length,
      newToday: users.filter((user) => user.createdAt && istDay(user.createdAt) === today).length,
      new7d: users.filter((user) => (user.createdAt ?? "") >= ago(7)).length,
      new30d: users.filter((user) => (user.createdAt ?? "") >= ago(30)).length,
      newInRange: users.filter((user) => inRange(user.createdAt, range)).length,
      signedInInRange: users.filter((user) => inRange(user.lastSignInAt, range)).length,
      neverGenerated: users.filter((user) => user.ewbTotal === 0).length,
    },
    ewbs: {
      allTime: snap.ewbs.length,
      generated: generated.length,
      today: snap.ewbs.filter((ewb) => istDay(ewb.generatedAt) === today).length,
      active: generated.filter((ewb) => ewb.status === "active" || ewb.status === "part_b_pending").length,
      partBPending: generated.filter((ewb) => ewb.status === "part_b_pending").length,
      expired: generated.filter((ewb) => ewb.status === "expired").length,
      cancelled: generated.filter((ewb) => ewb.status === "cancelled").length,
      // Attempts are counted from provider calls: a rejected or failed generate call is a failed attempt.
      attempts: generateCalls.length,
      failedAttempts: generateCalls.filter((record) => record["outcome"] !== "ok").length,
      successRate: generateCalls.length ? generateCalls.filter((record) => record["outcome"] === "ok").length / generateCalls.length : null,
      series: series(range, generated.map((ewb) => ({ at: ewb.generatedAt, value: 1 }))),
    },
    api: { ...summarizeApi(records), capped, series: series(range, records.map((record) => ({ at: record.at, value: 1 }))) },
    quota: await providerQuota(),
    credits: {
      purchased: sumCredits((entry) => entry.kind === "topup" && entry.status === "credited"),
      granted: sumCredits((entry) => entry.kind === "grant"),
      adjustedIn: sumCredits((entry) => entry.kind === "adjust" && entry.credits > 0),
      adjustedOut: -sumCredits((entry) => entry.kind === "adjust" && entry.credits < 0),
      consumed: -sumCredits((entry) => entry.status === "charged"),
      // Holds returned because the provider rejected or did not answer: never consumed.
      returnedHolds: -sumCredits((entry) => entry.status === "refunded"),
      outstanding: users.reduce((total, user) => total + user.balance, 0),
      heldNow: users.reduce((total, user) => total + user.heldCredits, 0),
      ledgerTrimmed: snap.ledgerTrimmed,
    },
    payments: {
      paidCount: paidIn.length,
      grossPaise: paidIn.reduce((total, purchase) => total + purchase.amountPaise, 0),
      creditsSold: paidIn.reduce((total, purchase) => total + purchase.credits, 0),
      todayCount: paidToday.length,
      todayPaise: paidToday.reduce((total, purchase) => total + purchase.amountPaise, 0),
      pending: real.filter((purchase) => purchase.status === "created").length,
      expiredOrCancelled: real.filter((purchase) => (purchase.status === "expired" || purchase.status === "cancelled") && inRange(purchase.createdAt, range)).length,
      sandboxPurchases: snap.purchases.filter((purchase) => purchase.provider === "sandbox" && inRange(purchase.createdAt, range)).length,
      series: series(range, paidIn.map((purchase) => ({ at: purchase.paidAt!, value: purchase.amountPaise }))),
    },
    recent: {
      payments: real.filter((purchase) => purchase.status === "paid").sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")).slice(0, 8),
      ewbs: [...snap.ewbs].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, 8),
      admin: await queryLogs("admin_audit", { limit: 8 }),
    },
  };
}

/* ---------- Reconciliation ---------- */

export type Finding = { severity: "high" | "medium" | "low"; kind: string; uid: string; target: string | null; detail: string };

/**
 * Cross-checks payments, credit ledger and e-way bills, per account. Every
 * finding names the records involved; none is fixed automatically.
 */
export async function reconcile(): Promise<{ builtAt: string; findings: Finding[]; checked: Record<string, number>; ledgerTrimmed: boolean }> {
  const snap = await snapshot(true);
  const findings: Finding[] = [];
  const now = Date.now();
  const events = await queryLogs("payment_events", { from: new Date(now - 90 * 86_400_000).toISOString(), limit: 20_000 });
  const purchaseIds = new Set(snap.purchases.map((purchase) => purchase.id));

  for (const [uid, workspace] of snap.workspaces) {
    const entries = workspace.wallet.ledger;
    const trimmed = entries.length >= 1000;
    const topups = entries.filter((entry) => entry.kind === "topup" && entry.status === "credited");
    for (const purchase of Object.values(workspace.purchases)) {
      const linked = topups.filter((entry) => entry.targetId === purchase.id || (purchase.paymentId && entry.note?.includes(purchase.paymentId)));
      if (purchase.status === "paid" && !linked.length && !trimmed) {
        // Top-ups made before purchase links were recorded carry only a note; flag them for a manual look.
        findings.push({ severity: "high", kind: "paid_not_credited", uid, target: purchase.id, detail: `Purchase of ${purchase.credits} credits (₹${(purchase.amountPaise / 100).toFixed(2)}) is paid but no matching credit entry was found.` });
      }
      if (linked.length > 1) findings.push({ severity: "high", kind: "credited_twice", uid, target: purchase.id, detail: `${linked.length} credit entries for one purchase.` });
      if (purchase.status !== "paid" && linked.length) findings.push({ severity: "high", kind: "credited_without_payment", uid, target: purchase.id, detail: `Credits were added but the purchase is "${purchase.status}".` });
      if (purchase.status === "created" && purchase.provider === "razorpay" && now - Date.parse(purchase.createdAt) > 60 * 60_000) {
        findings.push({ severity: "low", kind: "unconfirmed_payment", uid, target: purchase.id, detail: "Payment link older than an hour still shows as unpaid. Re-check it with Razorpay." });
      }
    }
    for (const entry of topups) {
      if (entry.targetId && !workspace.purchases[entry.targetId]) findings.push({ severity: "high", kind: "credit_without_purchase", uid, target: entry.id, detail: `Top-up of ${entry.credits} credits refers to an unknown purchase.` });
    }
    const charges = entries.filter((entry) => entry.kind === "generate" && entry.status === "charged");
    const charged = new Map<string, number>();
    for (const entry of charges) if (entry.targetId) charged.set(entry.targetId, (charged.get(entry.targetId) ?? 0) + 1);
    for (const [ewbId, count] of charged) {
      if (!workspace.ewbs[ewbId]) findings.push({ severity: "high", kind: "charge_without_bill", uid, target: ewbId, detail: "Credits were charged for an e-way bill that is not on record." });
      if (count > 1) findings.push({ severity: "high", kind: "bill_charged_twice", uid, target: ewbId, detail: `One e-way bill was charged ${count} times.` });
    }
    if (!trimmed) {
      for (const ewb of Object.values(workspace.ewbs)) {
        if (!charged.has(ewb.id)) findings.push({ severity: "medium", kind: "bill_without_charge", uid, target: ewb.id, detail: `E-way bill ${ewb.ewbNumber} has no generation charge (free cost setting, or a missing ledger entry).` });
      }
      const expected = entries.filter((entry) => entry.status !== "refunded").reduce((total, entry) => total + entry.credits, 0);
      if (expected !== workspace.wallet.balance) findings.push({ severity: "high", kind: "balance_mismatch", uid, target: null, detail: `Balance is ${workspace.wallet.balance} but the ledger adds up to ${expected}.` });
    }
    if (workspace.wallet.balance < 0) findings.push({ severity: "high", kind: "negative_balance", uid, target: null, detail: `Balance is ${workspace.wallet.balance}.` });
    for (const entry of entries) {
      if (entry.status === "held" && now - Date.parse(entry.at) > 15 * 60_000) findings.push({ severity: "medium", kind: "stuck_hold", uid, target: entry.id, detail: `${-entry.credits} credits held since ${entry.at} for "${entry.kind}" (an interrupted request). They return on the next retry of that invoice.` });
    }
    const numbers = new Map<string, number>();
    for (const ewb of Object.values(workspace.ewbs)) numbers.set(ewb.ewbNumber, (numbers.get(ewb.ewbNumber) ?? 0) + 1);
    for (const [number, count] of numbers) if (count > 1) findings.push({ severity: "high", kind: "duplicate_bill_record", uid, target: number, detail: `E-way bill ${number} is recorded ${count} times.` });
  }
  for (const event of events) {
    if (event["credited"] === true && typeof event["linkId"] === "string" && !purchaseIds.has(event["linkId"])) {
      findings.push({ severity: "high", kind: "event_for_unknown_purchase", uid: String(event["workspaceId"] ?? ""), target: event["linkId"], detail: "A webhook credited a purchase that is not on record." });
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { builtAt: snap.builtAt, findings, checked: { accounts: snap.workspaces.size, purchases: snap.purchases.length, ledgerEntries: snap.ledger.length, ewbs: snap.ewbs.length, webhookEvents: events.length }, ledgerTrimmed: snap.ledgerTrimmed };
}
