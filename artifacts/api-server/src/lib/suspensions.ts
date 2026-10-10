import { logger } from "./logger";
import { readDoc, withDoc } from "./store";

/**
 * Accounts an administrator suspended. Firebase sign-in is disabled too, but
 * an ID token already issued stays valid for up to an hour; this list makes
 * the API refuse such a token within a minute. Kept as one small document,
 * read at most once a minute per server instance.
 */
type Suspended = Record<string, { at: string; by: string; reason: string }>;

const REFRESH_MS = 60_000;
let cached: { ids: Set<string>; loadedAt: number } | null = null;

async function load() {
  if (cached && Date.now() - cached.loadedAt < REFRESH_MS) return cached.ids;
  try {
    const doc = (await readDoc<Suspended>("admin_state", "suspended")) ?? {};
    cached = { ids: new Set(Object.keys(doc)), loadedAt: Date.now() };
  } catch (error) {
    // Keep the last known list rather than letting everyone in or locking everyone out.
    logger.warn({ err: (error as Error).message }, "Could not load suspended accounts");
    cached = { ids: cached?.ids ?? new Set(), loadedAt: Date.now() };
  }
  return cached.ids;
}

export async function isSuspended(workspaceId: string) {
  return (await load()).has(workspaceId);
}

export async function suspendedAccounts(): Promise<Suspended> {
  return (await readDoc<Suspended>("admin_state", "suspended")) ?? {};
}

export async function setSuspended(workspaceId: string, suspended: boolean, by: string, reason: string) {
  await withDoc<Suspended, null>("admin_state", "suspended", (current) => {
    const next = { ...(current ?? {}) };
    if (suspended) next[workspaceId] = { at: new Date().toISOString(), by, reason };
    else delete next[workspaceId];
    return { next, result: null };
  });
  cached = null;
}
