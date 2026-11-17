import { directory, type DirectoryUser } from "./admin-directory";
import { istDay, SHARDS, STAT_KEYS, sumShards, type StatKey, type StatTotals, type UserIndex } from "./metrics";
import { queryLogs, queryUserIndex, readDoc, readStats, withDoc, type IndexQuery } from "./store";
import { suspendedAccounts } from "./suspensions";

/**
 * The admin panel at any number of accounts: the overview from the daily counters and the
 * Users page from the user index, a page at a time. Used once the one-time rebuild has
 * filled them (`metricsReady`); before that the panel reads the shared snapshot.
 */

type Range = { from: string; to: string };

let ready: { value: boolean; at: number } | null = null;

/** Whether the counters and the user index were built for the existing data. */
export async function metricsReady() {
  if (ready && Date.now() - ready.at < 60_000) return ready.value;
  const state = await readDoc<{ ready?: boolean }>("admin_state", "metrics").catch(() => null);
  ready = { value: Boolean(state?.ready), at: Date.now() };
  return ready.value;
}

export async function setMetricsReady(value: boolean, by: string) {
  await withDoc<{ ready: boolean; at: string; by: string }, null>("admin_state", "metrics", () => ({ next: { ready: value, at: new Date().toISOString(), by }, result: null }));
  ready = { value, at: Date.now() };
}

/** The India-time days from `from` to `to` (at most 400). */
export function daysOf(range: Range) {
  const days: string[] = [];
  const end = istDay(range.to);
  let day = istDay(range.from);
  for (let guard = 0; day <= end && guard < 400; guard++) {
    days.push(day);
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return days;
}

const shardIds = (prefix: string) => Array.from({ length: SHARDS }, (_, shard) => `${prefix}_${shard}`);

/** Totals for the range, per day (for charts), today and all time: (days + 2) × SHARDS small documents. */
export async function counters(range: Range) {
  const days = daysOf(range);
  const today = istDay(new Date().toISOString());
  const [perDay, todayDocs, allDocs] = await Promise.all([
    Promise.all(days.map(async (day) => ({ day, totals: sumShards(await readStats(shardIds(day))) }))),
    readStats(shardIds(today)),
    readStats(shardIds("total")),
  ]);
  const inRange = Object.fromEntries(STAT_KEYS.map((key) => [key, perDay.reduce((sum, item) => sum + item.totals[key], 0)])) as StatTotals;
  const series = (key: StatKey) => perDay.map((item) => ({ day: item.day, value: item.totals[key] }));
  return { inRange, today: sumShards(todayDocs), allTime: sumShards(allDocs), series };
}

const count = async (where?: IndexQuery["where"]) => (await queryUserIndex({ where, orderBy: "createdAt", direction: "desc", limit: 0 })).total;

/** The overview (same shape as the snapshot one; values that need every record are null). */
export async function overviewFromCounters(range: Range, extras: { api: unknown; quota: unknown }) {
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const startOfToday = new Date(`${istDay(new Date(now).toISOString())}T00:00:00+05:30`).toISOString();
  const [c, last30, total, newToday, new7d, new30d, newInRange, neverGenerated, usersMaking, usersLast30, suspended, recentEwbs, recentPayments, admin] = await Promise.all([
    counters(range),
    counters({ from: ago(30), to: new Date(now).toISOString() }),
    count(),
    count({ field: "createdAt", op: ">=", value: startOfToday }),
    count({ field: "createdAt", op: ">=", value: ago(7) }),
    count({ field: "createdAt", op: ">=", value: ago(30) }),
    count({ field: "createdAt", op: ">=", value: range.from }).then(async (since) => since - (await count({ field: "createdAt", op: ">", value: range.to }))),
    count({ field: "ewbTotal", op: "==", value: 0 }),
    count({ field: "invoiceCount", op: ">", value: 0 }),
    count({ field: "lastInvoiceAt", op: ">=", value: ago(30) }),
    suspendedAccounts(),
    queryLogs("api_calls", { limit: 300 }),
    queryLogs("payment_events", { limit: 50 }),
    queryLogs("admin_audit", { limit: 8 }),
  ]);
  const generated = c.inRange.ewbsGenerated;
  const attempts = c.inRange.ewbAttempts;
  return {
    range,
    builtAt: new Date(now).toISOString(),
    fromCounters: true,
    users: {
      total, verified: null, unverified: null, suspended: Object.keys(suspended).length,
      newToday, new7d, new30d, newInRange, signedInInRange: null, neverGenerated,
    },
    invoices: {
      total: c.allTime.invoices, purchases: c.allTime.purchaseBills, drafts: null,
      last30: last30.inRange.invoices + last30.inRange.purchaseBills,
      usersMaking, usersLast30, usersNever: Math.max(0, total - usersMaking),
    },
    ewbs: {
      allTime: c.allTime.ewbsGenerated, generated, today: c.today.ewbsGenerated,
      active: null, partBPending: null, expired: null, cancelled: c.inRange.ewbsCancelled,
      attempts, failedAttempts: c.inRange.ewbFailed, successRate: attempts ? generated / attempts : null,
      series: c.series("ewbsGenerated"),
    },
    ...extras,
    credits: {
      purchased: c.inRange.creditsSold, granted: c.inRange.creditsGranted, adjustedIn: c.inRange.creditsAdjustedIn, adjustedOut: c.inRange.creditsAdjustedOut,
      consumed: c.inRange.creditsConsumed, returnedHolds: c.inRange.creditsReturned,
      outstanding: c.allTime.creditsSold + c.allTime.creditsGranted + c.allTime.creditsAdjustedIn - c.allTime.creditsAdjustedOut - c.allTime.creditsConsumed,
      heldNow: null, ledgerTrimmed: false,
    },
    payments: {
      paidCount: c.inRange.paymentsPaid, grossPaise: c.inRange.paidPaise, creditsSold: c.inRange.creditsSold,
      todayCount: c.today.paymentsPaid, todayPaise: c.today.paidPaise, pending: null, expiredOrCancelled: null, sandboxPurchases: null,
      series: c.series("paidPaise"),
    },
    recent: {
      // From the logs already kept (no extra documents): the latest bills made and payments credited.
      ewbs: recentEwbs.filter((call) => call["operation"] === "ewb_generate" && call["outcome"] === "ok" && call["ewbNumber"]).slice(0, 8)
        .map((call) => ({ id: String(call["ewbNumber"]), uid: String(call["workspaceId"] ?? ""), ewbNumber: String(call["ewbNumber"]), generatedAt: call.at, status: "active", userEmail: null })),
      payments: recentPayments.filter((event) => event["credited"] === true).slice(0, 8)
        .map((event) => ({ id: String(event["linkId"]), uid: String(event["workspaceId"] ?? ""), amountPaise: Number(event["amountPaid"] ?? 0), credits: null, paidAt: event.at, userEmail: null })),
      admin,
    },
  };
}

/** Users page filters and sorts the index can answer without a composite index. */
const SORTS: Record<string, keyof UserIndex> = { createdAt: "createdAt", balance: "balance", ewbTotal: "ewbTotal", invoiceCount: "invoiceCount", lastInvoiceAt: "lastInvoiceAt", paidPaise: "paidPaise", lastSignInAt: "lastActivityAt" };

export function indexQueryOf(params: Record<string, string>): IndexQuery {
  const orderBy = SORTS[params["sort"] ?? ""] ?? "createdAt";
  const direction = params["dir"] === "asc" ? "asc" : "desc";
  const ago30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  // One filter at a time (the first one set wins); see the panel's note.
  const where: IndexQuery["where"] =
    params["paid"] === "yes" ? { field: "paidPaise", op: ">", value: 0 }
    : params["paid"] === "no" ? { field: "paidPaise", op: "==", value: 0 }
    : params["bills"] === "yes" ? { field: "ewbTotal", op: ">", value: 0 }
    : params["bills"] === "no" ? { field: "ewbTotal", op: "==", value: 0 }
    : params["invoices"] === "yes" ? { field: "invoiceCount", op: ">", value: 0 }
    : params["invoices"] === "no" ? { field: "invoiceCount", op: "==", value: 0 }
    : params["invoices"] === "recent" ? { field: "lastInvoiceAt", op: ">=", value: ago30 }
    : params["credits"] === "zero" ? { field: "balance", op: "==", value: 0 }
    : params["credits"] === "low" ? { field: "balance", op: "<", value: 5 }
    : undefined;
  return { where, orderBy, direction, limit: 50, after: params["after"] || undefined };
}

/** Index rows with the account details (name, email, sign-in) from Firebase Authentication. */
export async function usersPage(query: IndexQuery) {
  const [page, suspended] = await Promise.all([queryUserIndex(query), suspendedAccounts()]);
  const accounts = await accountsFor(page.rows.map((row) => row.uid));
  const items = page.rows.map((row) => {
    const account = accounts.get(row.uid);
    return {
      ...row,
      email: account?.email ?? null,
      name: account?.name ?? null,
      emailVerified: account?.emailVerified ?? false,
      disabled: account?.disabled ?? false,
      suspended: row.uid in suspended,
      lastSignInAt: account?.lastSignInAt ?? null,
      invoicesLast30: 0,
      draftCount: 0,
      hasWorkspace: true,
    };
  });
  return { items, total: page.total, next: page.next };
}

/** Accounts by uid (Firebase Authentication; no database reads). */
export async function accountsFor(uids: string[]) {
  const dir = directory();
  const found = await Promise.all(uids.map((uid) => dir.get(uid).catch(() => null)));
  return new Map(found.filter((user): user is DirectoryUser => Boolean(user)).map((user) => [user.uid, user]));
}
