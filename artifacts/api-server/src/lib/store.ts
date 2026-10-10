import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EwbInput } from "./validation";

/**
 * Workspace-scoped persistence. Each workspace is one JSON document written
 * atomically, with writes serialized per workspace. This keeps the service
 * dependency-free for development; swap `WorkspaceStore` for the Postgres
 * implementation (lib/db) before running at production scale.
 */

export type EwbStatus = "active" | "expired" | "cancelled" | "part_b_pending";

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
  totals: EwbInput["totals"];
  lines: EwbInput["lines"];
  transport: EwbInput["transport"];
  history: { at: string; action: string; detail: string }[];
  cancelledAt?: string;
  cancelReason?: string;
  /** Consolidated e-way bill this bill was moved under, if any. */
  consolidatedInto?: string;
  extensionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type EwbRequest = {
  id: string;
  idempotencyKey: string;
  invoiceId: string;
  state: "pending" | "generated" | "rejected";
  ewbId?: string;
  safeErrorCode?: string;
  createdAt: string;
  completedAt?: string;
};

export type GstSnapshot = {
  id: string;
  gstin: string;
  returnType: "GSTR-1" | "GSTR-2B" | "GSTR-3B";
  period: string;
  providerStatus: "filed" | "not_filed" | "in_progress" | "not_available";
  filedOn?: string;
  dueDate?: string;
  arn?: string;
  checkedAt: string;
  source: string;
};

export type Subscription = {
  planId: string;
  entitlementState: "trial" | "active" | "grace" | "expired";
  usagePeriod: string;
  usageCount: number;
  renewalAt: string;
  updatedAt: string;
  billingHistory: { at: string; planId: string; amountPaise: number; reference: string }[];
};

/** Consolidated e-way bill (one vehicle carrying several bills). */
export type CewbRecord = {
  id: string;
  cewbNumber: string;
  provider: string;
  ewbIds: string[];
  ewbNumbers: string[];
  vehicleNumber: string;
  fromPlace: string;
  fromState: string;
  transMode: string;
  transDocNo?: string;
  transDocDate?: string;
  generatedAt: string;
  createdAt: string;
};

export type WalletAction = "generate" | "part_b" | "consolidate" | "cancel" | "extend";
export type WalletEntry = {
  id: string;
  at: string;
  kind: WalletAction | "grant" | "topup";
  /** Signed: negative for charges, positive for grants/top-ups. */
  credits: number;
  /** "held" while the provider call runs; "charged" on success; "refunded" on failure. */
  status: "held" | "charged" | "refunded" | "credited";
  ewbNumber?: string;
  targetId?: string;
  note?: string;
};
export type Wallet = { balance: number; ledger: WalletEntry[] };

/** E-way bill portal API login for one GSTIN. The password is encrypted at rest. */
export type EwbCredential = { gstin: string; username: string; passwordEnc: string; updatedAt: string };

export type SyncRecord = { id: string; updatedAt: string; deleted?: boolean; data?: unknown };

export type Workspace = {
  id: string;
  createdAt: string;
  ewbs: Record<string, EwbRecord>;
  requests: Record<string, EwbRequest>;
  gst: Record<string, GstSnapshot>;
  gstLastSyncAt: Record<string, string>;
  subscription: Subscription;
  wallet: Wallet;
  cewbs: Record<string, CewbRecord>;
  ewbCredentials: Record<string, EwbCredential>;
  audit: { at: string; actor: string; action: string; targetId: string; outcome: string }[];
  sync: Record<string, Record<string, SyncRecord>>;
};

const dataDir = path.resolve(process.env["DATA_DIR"] ?? path.join(process.cwd(), ".data"));
const cache = new Map<string, Workspace>();
const queues = new Map<string, Promise<unknown>>();

/** Credits a new workspace starts with (WALLET_START_CREDITS, default 100). */
function startCredits() {
  const value = Number(process.env["WALLET_START_CREDITS"] ?? 100);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function currentPeriod(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function freshWorkspace(id: string): Workspace {
  const now = new Date();
  return {
    id,
    createdAt: now.toISOString(),
    ewbs: {},
    requests: {},
    gst: {},
    gstLastSyncAt: {},
    subscription: {
      planId: "free",
      entitlementState: "trial",
      usagePeriod: currentPeriod(now),
      usageCount: 0,
      renewalAt: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
      updatedAt: now.toISOString(),
      billingHistory: [],
    },
    wallet: { balance: startCredits(), ledger: startCredits() ? [{ id: `grant-${id}`, at: now.toISOString(), kind: "grant", credits: startCredits(), status: "credited", note: "Welcome credits" }] : [] },
    cewbs: {},
    ewbCredentials: {},
    audit: [],
    sync: {},
  };
}

function fileFor(id: string) {
  return path.join(dataDir, "workspaces", `${id}.json`);
}

async function load(id: string) {
  const cached = cache.get(id);
  if (cached) return cached;
  let workspace: Workspace;
  try {
    workspace = { ...freshWorkspace(id), ...(JSON.parse(await readFile(fileFor(id), "utf8")) as Workspace) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    workspace = freshWorkspace(id);
  }
  cache.set(id, workspace);
  return workspace;
}

async function persist(workspace: Workspace) {
  const file = fileFor(workspace.id);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(workspace));
  await rename(temp, file);
}

/** Runs `fn` with exclusive access to the workspace and saves the result. */
export function withWorkspace<T>(id: string, fn: (workspace: Workspace) => T | Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const workspace = await load(id);
    const result = await fn(workspace);
    await persist(workspace);
    return result;
  });
  queues.set(id, next);
  return next;
}

/** Shared (not per-workspace) JSON documents, e.g. the verified-GSTIN registry. */
export function sharedFile(...parts: string[]) {
  return path.join(dataDir, ...parts);
}

export function readWorkspace(id: string) {
  return withWorkspace(id, (workspace) => workspace);
}

export function audit(workspace: Workspace, actor: string, action: string, targetId: string, outcome: string) {
  workspace.audit.push({ at: new Date().toISOString(), actor, action, targetId, outcome });
  if (workspace.audit.length > 500) workspace.audit.splice(0, workspace.audit.length - 500);
}
