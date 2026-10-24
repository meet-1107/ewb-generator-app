import { randomUUID } from "node:crypto";
import { welcomeCredits } from "./welcome";
import type { Wallet, WalletAction, WalletEntry, Workspace } from "./store";

/**
 * Credit wallet. Credits are held before a provider call and either charged
 * (success) or refunded (rejection / error), so a failed call never costs the
 * user anything and two parallel calls cannot overspend the balance.
 *
 * Costs default to generate 5, Part-B 5, consolidate 5, cancel 5, extend 5;
 * override with CREDIT_COSTS_JSON, e.g. {"generate":5,"extend":5}.
 */

const defaults: Record<WalletAction, number> = { generate: 5, part_b: 5, consolidate: 5, cancel: 5, extend: 5 };

export const creditCosts: Record<WalletAction, number> = {
  ...defaults,
  ...(process.env["CREDIT_COSTS_JSON"] ? (JSON.parse(process.env["CREDIT_COSTS_JSON"]) as Partial<Record<WalletAction, number>>) : {}),
};

export const ACTION_LABELS: Record<WalletEntry["kind"], string> = {
  generate: "E-way bill generated",
  part_b: "Part-B / vehicle updated",
  consolidate: "Consolidated e-way bill",
  cancel: "E-way bill cancelled",
  extend: "Validity extended",
  grant: "Welcome credits",
  topup: "Credits added",
  adjust: "Adjusted by support",
};

const LEDGER_LIMIT = 1000;

function trim(wallet: Wallet) {
  if (wallet.ledger.length > LEDGER_LIMIT) wallet.ledger.splice(0, wallet.ledger.length - LEDGER_LIMIT);
}

export type Hold = { ok: true; entryId: string | null; cost: number } | { ok: false; cost: number; balance: number };

/** Reserves the action's cost. Free actions return a hold with no ledger entry. */
export function holdCredits(workspace: Workspace, action: WalletAction, targetId?: string): Hold {
  const cost = creditCosts[action];
  if (!cost) return { ok: true, entryId: null, cost: 0 };
  if (workspace.wallet.balance < cost) return { ok: false, cost, balance: workspace.wallet.balance };
  const entry: WalletEntry = { id: randomUUID(), at: new Date().toISOString(), kind: action, credits: -cost, status: "held", targetId };
  workspace.wallet.balance -= cost;
  workspace.wallet.ledger.push(entry);
  trim(workspace.wallet);
  return { ok: true, entryId: entry.id, cost };
}

export function settleCredits(workspace: Workspace, entryId: string | null, details: { ewbNumber?: string; targetId?: string; note?: string }) {
  const entry = entryId ? workspace.wallet.ledger.find((item) => item.id === entryId) : undefined;
  if (!entry || entry.status !== "held") return;
  entry.status = "charged";
  Object.assign(entry, details);
}

export function refundCredits(workspace: Workspace, entryId: string | null, note: string) {
  const entry = entryId ? workspace.wallet.ledger.find((item) => item.id === entryId) : undefined;
  if (!entry || entry.status !== "held") return;
  entry.status = "refunded";
  entry.note = note;
  workspace.wallet.balance += -entry.credits;
}

/** `targetId`: the purchase the credits were bought with, so payments and credits can be reconciled. */
export function addCredits(workspace: Workspace, credits: number, note: string, targetId?: string) {
  workspace.wallet.balance += credits;
  workspace.wallet.ledger.push({ id: randomUUID(), at: new Date().toISOString(), kind: "topup", credits, status: "credited", note, ...(targetId ? { targetId } : {}) });
  trim(workspace.wallet);
}

export type Adjustment = { ok: true; entry: WalletEntry; replay: boolean; balance: number } | { ok: false; balance: number };

/**
 * A manual credit change by an administrator, applied once per `reference`
 * (a retried request returns the first result). Never takes the balance below zero.
 */
export function adjustCredits(workspace: Workspace, { credits, reason, actor, reference }: { credits: number; reason: string; actor: string; reference: string }): Adjustment {
  const id = `adj_${reference}`;
  const existing = workspace.wallet.ledger.find((entry) => entry.id === id);
  if (existing) return { ok: true, entry: existing, replay: true, balance: workspace.wallet.balance };
  if (workspace.wallet.balance + credits < 0) return { ok: false, balance: workspace.wallet.balance };
  const entry: WalletEntry = { id, at: new Date().toISOString(), kind: "adjust", credits, status: "credited", note: reason, actor };
  workspace.wallet.balance += credits;
  workspace.wallet.ledger.push(entry);
  trim(workspace.wallet);
  return { ok: true, entry, replay: false, balance: workspace.wallet.balance };
}

/** Calendar month (YYYY-MM) of an entry in India time. */
function istMonth(iso: string) {
  return new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

const visible = (workspace: Workspace) => workspace.wallet.ledger.filter((entry) => entry.status !== "held");
const labelled = (entry: WalletEntry) => ({ ...entry, label: ACTION_LABELS[entry.kind] });

/** Months that have history, newest first, with credits added and used in each. */
function historyMonths(entries: WalletEntry[]) {
  const months = new Map<string, { month: string; count: number; added: number; used: number }>();
  for (const entry of entries) {
    const month = istMonth(entry.at);
    const row = months.get(month) ?? { month, count: 0, added: 0, used: 0 };
    row.count++;
    if (entry.credits > 0) row.added += entry.credits;
    else if (entry.status === "charged") row.used -= entry.credits;
    months.set(month, row);
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** Entries shown at first, and per "Show more". */
export const HISTORY_PAGE = 20;

/**
 * History newest first: one month (YYYY-MM, India time) or every month ("").
 * With `page`, one page: the entries after `page.before` (an entry id), and whether more follow.
 * Without it, the whole month (older apps).
 */
export function walletHistory(workspace: Workspace, month: string, page?: { before?: string; limit: number }) {
  const all = visible(workspace).filter((entry) => !month || istMonth(entry.at) === month).reverse();
  if (!page) return { month, entries: all.map(labelled), more: false };
  const start = page.before ? all.findIndex((entry) => entry.id === page.before) + 1 : 0;
  const entries = all.slice(start, start + page.limit);
  return { month, entries: entries.map(labelled), more: start + entries.length < all.length };
}

export function walletSummary(workspace: Workspace) {
  const charged = workspace.wallet.ledger.filter((entry) => entry.status === "charged");
  const count = (kind: WalletAction) => charged.filter((entry) => entry.kind === kind).length;
  return {
    balance: workspace.wallet.balance,
    costs: creditCosts,
    counts: { generate: count("generate"), part_b: count("part_b"), consolidate: count("consolidate"), cancel: count("cancel"), extend: count("extend") },
    creditsUsed: charged.reduce((sum, entry) => sum - entry.credits, 0),
    // The first page only; the rest loads as the user taps Show more.
    ledger: visible(workspace).slice(-HISTORY_PAGE).reverse().map(labelled),
    ledgerMore: visible(workspace).length > HISTORY_PAGE,
    historyMonths: historyMonths(visible(workspace)),
    // Free trial credits still to come: given when the first GSTIN's portal login is saved.
    // None once a login is saved, even if it brought no credits (GSTIN already used, or not checked).
    welcomeCredits: workspace.welcomeGstin || Object.keys(workspace.ewbCredentials ?? {}).length || workspace.wallet.ledger.some((entry) => entry.kind === "grant") ? 0 : welcomeCredits(),
  };
}
