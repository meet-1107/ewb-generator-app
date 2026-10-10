import { randomUUID } from "node:crypto";
import type { Wallet, WalletAction, WalletEntry, Workspace } from "./store";

/**
 * Credit wallet. Credits are held before a provider call and either charged
 * (success) or refunded (rejection / error), so a failed call never costs the
 * user anything and two parallel calls cannot overspend the balance.
 *
 * Costs default to generate 10, Part-B 5, consolidate 5, cancel 5, extend 5;
 * override with CREDIT_COSTS_JSON, e.g. {"generate":10,"extend":5}.
 */

const defaults: Record<WalletAction, number> = { generate: 10, part_b: 5, consolidate: 5, cancel: 5, extend: 5 };

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

export function addCredits(workspace: Workspace, credits: number, note: string) {
  workspace.wallet.balance += credits;
  workspace.wallet.ledger.push({ id: randomUUID(), at: new Date().toISOString(), kind: "topup", credits, status: "credited", note });
  trim(workspace.wallet);
}

export function walletSummary(workspace: Workspace) {
  const charged = workspace.wallet.ledger.filter((entry) => entry.status === "charged");
  const count = (kind: WalletAction) => charged.filter((entry) => entry.kind === kind).length;
  return {
    balance: workspace.wallet.balance,
    costs: creditCosts,
    counts: { generate: count("generate"), part_b: count("part_b"), consolidate: count("consolidate"), cancel: count("cancel"), extend: count("extend") },
    creditsUsed: charged.reduce((sum, entry) => sum - entry.credits, 0),
    ledger: workspace.wallet.ledger.filter((entry) => entry.status !== "held").slice(-100).reverse().map((entry) => ({ ...entry, label: ACTION_LABELS[entry.kind] })),
  };
}
