import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { withDoc, withWorkspace } from "./store";

/**
 * Free trial credits (WELCOME_CREDITS, default 10), given once per GSTIN and once per
 * account: when an account first saves the e-way bill portal API login of a GSTIN that
 * has never had them. A second account with the same GSTIN gets none, so making new
 * sign-ins does not give more free e-way bills.
 */
export function welcomeCredits() {
  const value = Number(process.env["WELCOME_CREDITS"] ?? 10);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

type Claim = { gstin: string; workspaceId: string; credits: number; at: string };

export type WelcomeResult = { granted: number; balance?: number; reason?: "off" | "account_used" | "gstin_used" };

export async function grantWelcomeCredits(workspaceId: string, gstin: string): Promise<WelcomeResult> {
  const credits = welcomeCredits();
  if (!credits) return { granted: 0, reason: "off" };
  try {
    // The account already had its free credits (also the old sign-up grant).
    const accountUsed = await withWorkspace(workspaceId, (workspace) => Boolean(workspace.welcomeGstin) || workspace.wallet.ledger.some((entry) => entry.kind === "grant"));
    if (accountUsed) return { granted: 0, reason: "account_used" };
    const claimed = await withDoc<Claim, boolean>("welcome_grants", gstin, (current) =>
      current ? { next: current, result: current.workspaceId === workspaceId } : { next: { gstin, workspaceId, credits, at: new Date().toISOString() }, result: true });
    if (!claimed) return { granted: 0, reason: "gstin_used" };
    return await withWorkspace(workspaceId, (workspace) => {
      if (workspace.welcomeGstin) return { granted: 0, reason: "account_used" as const };
      workspace.welcomeGstin = gstin;
      workspace.wallet.balance += credits;
      workspace.wallet.ledger.push({ id: randomUUID(), at: new Date().toISOString(), kind: "grant", credits, status: "credited", note: `Free trial credits for ${gstin}` });
      return { granted: credits, balance: workspace.wallet.balance };
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Welcome credits failed");
    return { granted: 0 };
  }
}
