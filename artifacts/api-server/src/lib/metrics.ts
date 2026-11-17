import type { Workspace } from "./store";

/**
 * Counters for the admin panel, so it never has to read every account.
 *
 * - Daily totals (`stats/{YYYY-MM-DD}_{shard}` and `stats/total_{shard}`, India time):
 *   bumped with `bump()` inside the same `withWorkspace` transaction as the event, so each
 *   event counts exactly once. Spread over SHARDS documents: one document takes about one
 *   write a second, and many accounts write at the same time.
 * - Per account (`workspace.counts`, copied to `user_index/{uid}` with `indexOf()`): what the
 *   Users page lists, filters and sorts, a page at a time.
 */

export const SHARDS = 10;

export const STAT_KEYS = [
  "signups", "ewbsGenerated", "ewbsCancelled", "ewbAttempts", "ewbFailed",
  "invoices", "purchaseBills", "paymentsPaid", "paidPaise", "creditsSold",
  "creditsGranted", "creditsAdjustedIn", "creditsAdjustedOut", "creditsConsumed", "creditsReturned",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatTotals = Record<StatKey, number>;

/** Per-account counts kept on the workspace (copied to the user index). */
export type AccountCounts = {
  ewbs: number;
  ewbsCancelled: number;
  invoices: number;
  purchaseBills: number;
  paidPayments: number;
  paidPaise: number;
  lastInvoiceAt: string | null;
  lastEwbAt: string | null;
  lastActivityAt: string | null;
};

export type UserIndex = {
  uid: string;
  createdAt: string;
  businessName: string | null;
  gstin: string | null;
  balance: number;
  ewbTotal: number;
  ewbCancelled: number;
  invoiceCount: number;
  purchaseCount: number;
  lastInvoiceAt: string | null;
  paidPayments: number;
  paidPaise: number;
  hasPortalLogin: boolean;
  lastActivityAt: string | null;
};

const PENDING = Symbol("pendingStats");
type Pending = { day: string; key: StatKey; n: number }[];

/** YYYY-MM-DD in India time. */
export const istDay = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);

export const emptyCounts = (): AccountCounts => ({ ewbs: 0, ewbsCancelled: 0, invoices: 0, purchaseBills: 0, paidPayments: 0, paidPaise: 0, lastInvoiceAt: null, lastEwbAt: null, lastActivityAt: null });
export const emptyTotals = (): StatTotals => Object.fromEntries(STAT_KEYS.map((key) => [key, 0])) as StatTotals;

/** Account counts touched by each event, besides the daily total. */
const ACCOUNT_FIELD: Partial<Record<StatKey, keyof Pick<AccountCounts, "ewbs" | "ewbsCancelled" | "invoices" | "purchaseBills" | "paidPayments" | "paidPaise">>> = {
  ewbsGenerated: "ewbs", ewbsCancelled: "ewbsCancelled", invoices: "invoices", purchaseBills: "purchaseBills", paymentsPaid: "paidPayments", paidPaise: "paidPaise",
};

/**
 * Counts an event (call inside `withWorkspace`). The store writes the daily and all-time
 * totals in the same transaction; a retried transaction starts again from scratch, so an
 * event is never counted twice.
 */
export function bump(workspace: Workspace, key: StatKey, n = 1, at = new Date().toISOString()) {
  if (!n) return;
  const holder = workspace as unknown as { [PENDING]?: Pending };
  (holder[PENDING] ??= []).push({ day: istDay(at), key, n });
  const counts = (workspace.counts ??= emptyCounts());
  const field = ACCOUNT_FIELD[key];
  if (field) counts[field] = Math.max(0, counts[field] + n);
  if (key === "invoices" || key === "purchaseBills") counts.lastInvoiceAt = !counts.lastInvoiceAt || at > counts.lastInvoiceAt ? at : counts.lastInvoiceAt;
  if (key === "ewbsGenerated") counts.lastEwbAt = at;
  counts.lastActivityAt = !counts.lastActivityAt || at > counts.lastActivityAt ? at : counts.lastActivityAt;
}

/** A per-account count only (e.g. a deleted invoice), not a daily total. */
export function adjustAccount(workspace: Workspace, field: "invoices" | "purchaseBills", n: number) {
  const counts = (workspace.counts ??= emptyCounts());
  counts[field] = Math.max(0, counts[field] + n);
}

/** The events counted during this transaction, by document id → field → amount (taken once). */
export function takePending(workspace: Workspace): Map<string, Partial<StatTotals>> {
  const holder = workspace as unknown as { [PENDING]?: Pending };
  const pending = holder[PENDING] ?? [];
  delete holder[PENDING];
  const docs = new Map<string, Partial<StatTotals>>();
  if (!pending.length) return docs;
  // One shard per transaction (all its events land together); different accounts spread out.
  const shard = Math.floor(Math.random() * SHARDS);
  const add = (id: string, key: StatKey, n: number) => {
    const doc = docs.get(id) ?? {};
    doc[key] = (doc[key] ?? 0) + n;
    docs.set(id, doc);
  };
  for (const { day, key, n } of pending) {
    add(`${day}_${shard}`, key, n);
    add(`total_${shard}`, key, n);
  }
  return docs;
}

/** What the Users page shows for an account. */
export function indexOf(workspace: Workspace): UserIndex {
  const counts = workspace.counts ?? emptyCounts();
  return {
    uid: workspace.id,
    createdAt: workspace.createdAt,
    businessName: workspace.profile?.businessName ?? null,
    gstin: workspace.profile?.gstin ?? null,
    balance: workspace.wallet.balance,
    ewbTotal: counts.ewbs,
    ewbCancelled: counts.ewbsCancelled,
    invoiceCount: counts.invoices,
    purchaseCount: counts.purchaseBills,
    lastInvoiceAt: counts.lastInvoiceAt,
    paidPayments: counts.paidPayments,
    paidPaise: counts.paidPaise,
    hasPortalLogin: Object.keys(workspace.ewbCredentials ?? {}).length > 0,
    lastActivityAt: counts.lastActivityAt,
  };
}

/** Adds shard documents into totals. */
export function sumShards(docs: Partial<StatTotals>[]): StatTotals {
  const totals = emptyTotals();
  for (const doc of docs) for (const key of STAT_KEYS) totals[key] += Number(doc[key] ?? 0);
  return totals;
}
