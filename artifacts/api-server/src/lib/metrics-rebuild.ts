import { emptyCounts, istDay, type AccountCounts, type StatKey, type StatTotals } from "./metrics";
import { clearStats, peekWorkspace, withWorkspace, workspaceIdPage, writeStats, type Workspace } from "./store";

/**
 * One-time rebuild of the admin counters and the user index from the data already stored,
 * a page of accounts per call (a Cloud Function has a time limit). New events are counted
 * live from then on (lib/metrics.ts).
 */

type InvoiceData = { kind?: string; status?: string; unsaved?: boolean; createdAt?: string } | undefined;

/** What one account adds to the daily totals, and its own counts. */
export function historyOf(workspace: Workspace) {
  const days = new Map<string, Partial<StatTotals>>();
  const add = (at: string | null | undefined, key: StatKey, n = 1) => {
    if (!at || !n) return;
    const day = istDay(at);
    const doc = days.get(day) ?? {};
    doc[key] = (doc[key] ?? 0) + n;
    days.set(day, doc);
  };
  const counts: AccountCounts = emptyCounts();
  const seen = (at: string | null | undefined) => { if (at && (!counts.lastActivityAt || at > counts.lastActivityAt)) counts.lastActivityAt = at; };

  add(workspace.createdAt, "signups");
  for (const ewb of Object.values(workspace.ewbs)) {
    add(ewb.generatedAt, "ewbsGenerated");
    add(ewb.generatedAt, "ewbAttempts");
    counts.ewbs += 1;
    if (!counts.lastEwbAt || ewb.generatedAt > counts.lastEwbAt) counts.lastEwbAt = ewb.generatedAt;
    seen(ewb.generatedAt);
    if (ewb.status === "cancelled") {
      add(ewb.cancelledAt ?? ewb.updatedAt, "ewbsCancelled");
      counts.ewbsCancelled += 1;
    }
  }
  for (const record of Object.values(workspace.sync["invoices"] ?? {})) {
    const data = record.data as InvoiceData;
    if (record.deleted || !data || data.unsaved || data.status === "draft") continue;
    const at = data.createdAt ?? record.updatedAt;
    const purchase = data.kind === "purchase";
    add(at, purchase ? "purchaseBills" : "invoices");
    if (purchase) counts.purchaseBills += 1; else counts.invoices += 1;
    if (!counts.lastInvoiceAt || at > counts.lastInvoiceAt) counts.lastInvoiceAt = at;
    seen(at);
  }
  const purchaseIds = new Set<string>();
  for (const purchase of Object.values(workspace.purchases)) {
    if (purchase.status !== "paid") continue;
    purchaseIds.add(purchase.id);
    add(purchase.paidAt, "paymentsPaid");
    add(purchase.paidAt, "paidPaise", purchase.amountPaise);
    add(purchase.paidAt, "creditsSold", purchase.credits);
    counts.paidPayments += 1;
    counts.paidPaise += purchase.amountPaise;
    seen(purchase.paidAt);
  }
  for (const entry of workspace.wallet.ledger) {
    if (entry.kind === "grant") add(entry.at, "creditsGranted", entry.credits);
    else if (entry.kind === "adjust") add(entry.at, entry.credits > 0 ? "creditsAdjustedIn" : "creditsAdjustedOut", Math.abs(entry.credits));
    else if (entry.kind === "topup" && !(entry.targetId && purchaseIds.has(entry.targetId))) add(entry.at, "creditsAdjustedIn", entry.credits);
    else if (entry.status === "charged") add(entry.at, "creditsConsumed", -entry.credits);
    else if (entry.status === "refunded") add(entry.at, "creditsReturned", -entry.credits);
  }
  return { days, counts };
}

/**
 * Rebuilds a page of accounts. `reset` (the first call) clears the old counters.
 * Returns the cursor for the next call, or null when every account is done.
 */
export async function rebuildPage({ after, limit = 40, reset = false }: { after?: string; limit?: number; reset?: boolean }) {
  if (reset) await clearStats();
  const ids = await workspaceIdPage(after, limit);
  const page = new Map<string, Partial<StatTotals>>();
  const merge = (id: string, fields: Partial<StatTotals>) => {
    const doc = page.get(id) ?? {};
    for (const [key, n] of Object.entries(fields) as [StatKey, number][]) doc[key] = (doc[key] ?? 0) + n;
    page.set(id, doc);
  };
  for (const id of ids) {
    const workspace = await peekWorkspace(id, { ewbs: true, syncKeys: ["business/profile"], syncNames: ["invoices"] });
    if (!workspace) continue;
    const { days, counts } = historyOf(workspace);
    for (const [day, fields] of days) {
      merge(`${day}_0`, fields);
      merge("total_0", fields);
    }
    const business = workspace.sync["business"]?.["profile"]?.data as { name?: string; gstin?: string } | undefined;
    // Setting the counts writes the account's user index (store hook), with no live counter bump.
    await withWorkspace(id, (current) => {
      current.counts = counts;
      current.profile = { businessName: business?.name?.trim() || null, gstin: business?.gstin?.trim().toUpperCase() || null };
    });
  }
  await writeStats(page, { merge: true });
  return { processed: ids.length, next: ids.length === limit ? ids.at(-1)! : null };
}

