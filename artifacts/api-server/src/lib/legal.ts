import { readDoc, withDoc } from "./store";

/**
 * Version of the Terms & Conditions and Privacy Policy (hosting/terms.html,
 * hosting/privacy.html). Change it whenever either document changes in a way users
 * must agree to again: every account is then asked to accept the new version.
 */
export const LEGAL_VERSION = "2026-10-15";

export type ConsentRecord = { version: string; acceptedAt: string; method: "signup" | "google" | "prompt"; ip: string; userAgent: string };
type ConsentDoc = { workspaceId: string; current: ConsentRecord; history: ConsentRecord[] };

/** The account's latest acceptance (DPDP Act 2023: proof of consent), or null. */
export async function consentOf(workspaceId: string) {
  return (await readDoc<ConsentDoc>("consents", workspaceId))?.current ?? null;
}

/** Records that the account accepted the current documents; earlier acceptances are kept. */
export function recordConsent(workspaceId: string, record: Omit<ConsentRecord, "version" | "acceptedAt">) {
  const entry: ConsentRecord = { ...record, version: LEGAL_VERSION, acceptedAt: new Date().toISOString() };
  return withDoc<ConsentDoc, ConsentRecord>("consents", workspaceId, (current) => ({
    next: { workspaceId, current: entry, history: [...(current?.history ?? []), entry].slice(-20) },
    result: entry,
  }));
}
