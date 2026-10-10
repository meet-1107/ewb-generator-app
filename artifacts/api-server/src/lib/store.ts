import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EwbInput } from "./validation";

/**
 * Workspace-scoped persistence with two backends:
 *
 * - Firestore (STORE=firestore; always on Cloud Functions). The workspace's
 *   small fields live in `workspaces/{id}`; each record of the large
 *   sections (ewbs, requests, gst, cewbs, sync) is its own document in a
 *   subcollection of the same name. Every `withWorkspace` call is one
 *   Firestore transaction, so concurrent requests on any number of server
 *   instances cannot overspend credits or lose writes.
 * - JSON files under DATA_DIR (local development and tests), one file per
 *   workspace, writes serialized per workspace in this process.
 *
 * Callers name the large sections they use, so a request reads only those
 * records: `{ ewbs: "all" }` loads every bill, `{ ewbs: [id] }` only that one,
 * `{ ewbs: [] }` none (new records can still be added). Touching a section
 * that was not named throws, on both backends.
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

/** A credit purchase through a Razorpay payment link (or an instant sandbox purchase). */
export type CreditPurchase = {
  id: string;
  provider: "razorpay" | "sandbox";
  credits: number;
  amountPaise: number;
  status: "created" | "paid" | "expired" | "cancelled";
  shortUrl?: string;
  paymentId?: string;
  createdAt: string;
  paidAt?: string;
};

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
  purchases: Record<string, CreditPurchase>;
  audit: { at: string; actor: string; action: string; targetId: string; outcome: string }[];
  sync: Record<string, Record<string, SyncRecord>>;
};


export const SECTIONS = ["ewbs", "requests", "gst", "cewbs", "sync"] as const;
export type Section = (typeof SECTIONS)[number];
/**
 * Which records of each large section a call needs. `sync` is loaded whole
 * ("all"), or as the records named in `keys` ("collection/id") plus every
 * record changed after `since`, so a sync reads only what changed.
 */
export type SyncSpec = "all" | { keys: string[]; since?: string };
export type SectionSpec = { [K in Exclude<Section, "sync">]?: "all" | string[] } & { sync?: SyncSpec };
type Core = Omit<Workspace, Section>;

const backend = process.env["STORE"] === "firestore" ? "firestore" : "file";
const dataDir = path.resolve(process.env["DATA_DIR"] ?? path.join(process.cwd(), ".data"));

/** Credits a new workspace starts with (WALLET_START_CREDITS, default 0: every action is paid). */
function startCredits() {
  const value = Number(process.env["WALLET_START_CREDITS"] ?? 0);
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
    purchases: {},
    audit: [],
    sync: {},
  };
}

/** The workspace as `fn` sees it: sections that were not requested throw instead of reading as empty. */
function guard(workspace: Workspace, spec: SectionSpec): Workspace {
  return new Proxy(workspace, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && (SECTIONS as readonly string[]).includes(prop) && !(prop in spec)) {
        throw new Error(`withWorkspace: section "${prop}" was used but not requested.`);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Runs `fn` with exclusive access to the workspace and saves what it changed. `fn` may run more than once (Firestore retries), so it must not call out. */
export function withWorkspace<T>(id: string, fn: (workspace: Workspace) => T | Promise<T>, spec: SectionSpec = {}): Promise<T> {
  return backend === "firestore" ? firestoreWorkspace(id, fn, spec) : fileWorkspace(id, fn, spec);
}

/**
 * Small shared documents (OTP challenges, the GSTIN registry) with exclusive
 * access per document: `fn` gets the current value (or null) and returns the
 * next one, `null` to delete it. A throw leaves the document unchanged.
 * Concurrent calls cannot double-spend a code or grant.
 */
export function withDoc<T, R>(collection: string, id: string, fn: (current: T | null) => { next: T | null; result: R } | Promise<{ next: T | null; result: R }>): Promise<R> {
  return backend === "firestore" ? firestoreDoc(collection, id, fn) : fileDoc(collection, id, fn);
}

/** Reads a shared document without locking it. */
export async function readDoc<T>(collection: string, id: string): Promise<T | null> {
  if (backend === "file") return withDoc<T, T | null>(collection, id, (current) => ({ next: current, result: current }));
  const { db } = await firestore();
  const snap = await db.collection(collection).doc(docId(id)).get();
  return snap.exists ? (JSON.parse(String(snap.get("data"))) as T) : null;
}

export function audit(workspace: Workspace, actor: string, action: string, targetId: string, outcome: string) {
  workspace.audit.push({ at: new Date().toISOString(), actor, action, targetId, outcome });
  if (workspace.audit.length > 500) workspace.audit.splice(0, workspace.audit.length - 500);
}

/* ---------- JSON files (development) ---------- */

const cache = new Map<string, Workspace>();
const queues = new Map<string, Promise<unknown>>();

function workspaceFile(id: string) {
  return path.join(dataDir, "workspaces", `${id}.json`);
}

async function loadFile(id: string) {
  const cached = cache.get(id);
  if (cached) return cached;
  let workspace: Workspace;
  try {
    workspace = { ...freshWorkspace(id), ...(JSON.parse(await readFile(workspaceFile(id), "utf8")) as Workspace) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    workspace = freshWorkspace(id);
  }
  cache.set(id, workspace);
  return workspace;
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, file);
}

function fileWorkspace<T>(id: string, fn: (workspace: Workspace) => T | Promise<T>, spec: SectionSpec): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    // fn works on a copy, so a throw leaves the workspace exactly as it was.
    const workspace = structuredClone(await loadFile(id));
    const result = await fn(guard(workspace, spec));
    await writeJson(workspaceFile(id), workspace);
    cache.set(id, workspace);
    return result;
  });
  queues.set(id, next);
  return next;
}

const docQueues = new Map<string, Promise<unknown>>();

function fileDoc<T, R>(collection: string, id: string, fn: (current: T | null) => { next: T | null; result: R } | Promise<{ next: T | null; result: R }>): Promise<R> {
  const file = path.join(dataDir, collection, `${id}.json`);
  const previous = docQueues.get(file) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    let current: T | null = null;
    try {
      current = JSON.parse(await readFile(file, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const { next, result } = await fn(current);
    if (next === null) {
      if (current !== null) await rm(file, { force: true });
    } else {
      await writeJson(file, next);
    }
    return result;
  });
  // The queue entry swallows the outcome; the caller still receives `run`'s rejection.
  const settled: Promise<void> = run.then(() => undefined, () => undefined).finally(() => {
    if (docQueues.get(file) === settled) docQueues.delete(file);
  });
  docQueues.set(file, settled);
  return run;
}

/* ---------- Firestore (production) ---------- */

type FirestoreModule = typeof import("firebase-admin/firestore");
let firestoreReady: Promise<{ db: import("firebase-admin/firestore").Firestore; sdk: FirestoreModule }> | null = null;

function firestore() {
  firestoreReady ??= (async () => {
    // Loaded only on this backend, so local development needs no Google libraries.
    const [sdk, { firebaseApp }] = await Promise.all([import("firebase-admin/firestore"), import("./firebase")]);
    return { db: sdk.getFirestore(firebaseApp()), sdk };
  })();
  return firestoreReady;
}

/** Firestore document IDs cannot contain "/" or look like "__x__"; long keys are hashed. */
function docId(key: string) {
  const encoded = `k${encodeURIComponent(key)}`;
  return encoded.length <= 700 ? encoded : `h${createHash("sha256").update(key).digest("hex")}`;
}

/** One stored record of a large section. `name` is the sync collection, for `sync` only. */
type RecordDoc = { key: string; name?: string; json: string; updatedAt?: string };

function sectionEntries(workspace: Workspace, section: Section): { id: string; doc: RecordDoc }[] {
  if (section === "sync") {
    return Object.entries(workspace.sync).flatMap(([name, records]) =>
      Object.entries(records).map(([key, record]) => ({ id: docId(`${name}/${key}`), doc: { key, name, json: JSON.stringify(record), updatedAt: record.updatedAt } })),
    );
  }
  return Object.entries(workspace[section] as Record<string, unknown>).map(([key, record]) => ({ id: docId(key), doc: { key, json: JSON.stringify(record) } }));
}

function coreOf(workspace: Workspace): Core {
  const core: Record<string, unknown> = { ...workspace };
  for (const section of SECTIONS) delete core[section];
  return core as Core;
}

async function firestoreWorkspace<T>(id: string, fn: (workspace: Workspace) => T | Promise<T>, spec: SectionSpec): Promise<T> {
  const { db, sdk } = await firestore();
  const root = db.collection("workspaces").doc(id);
  const sections = SECTIONS.filter((section) => spec[section] !== undefined);

  return db.runTransaction(async (tx) => {
    const rootSnap = await tx.get(root);
    const loaded = await Promise.all(sections.map(async (section) => {
      const wanted = spec[section]!;
      if (wanted === "all") return (await tx.get(root.collection(section))).docs;
      if (!Array.isArray(wanted)) {
        // sync: the named records plus those changed after `since`, read once each.
        const named = wanted.keys.length ? await tx.getAll(...[...new Set(wanted.keys)].map((key) => root.collection(section).doc(docId(key)))) : [];
        const changed = wanted.since ? (await tx.get(root.collection(section).where("updatedAt", ">", wanted.since))).docs : (await tx.get(root.collection(section))).docs;
        const seen = new Set<string>();
        return [...named, ...changed].filter((snap) => snap.exists && !seen.has(snap.id) && seen.add(snap.id));
      }
      if (!wanted.length) return [];
      return (await tx.getAll(...[...new Set(wanted)].map((key) => root.collection(section).doc(docId(key))))).filter((snap) => snap.exists);
    }));

    const coreBefore = rootSnap.exists ? String(rootSnap.get("data")) : null;
    const workspace: Workspace = { ...freshWorkspace(id), ...(coreBefore ? (JSON.parse(coreBefore) as Core) : {}) };
    const before = new Map<string, string>();
    sections.forEach((section, index) => {
      for (const snap of loaded[index]!) {
        const doc = snap.data() as RecordDoc;
        // Sync records saved before `updatedAt` was stored are rewritten once, so the `since` query finds them.
        before.set(`${section}/${snap.id}`, section === "sync" && doc.updatedAt === undefined ? "" : doc.json);
        const value = JSON.parse(doc.json) as never;
        if (section === "sync") (workspace.sync[doc.name!] ??= {})[doc.key] = value;
        else (workspace[section] as Record<string, unknown>)[doc.key] = value;
      }
    });

    const result = await fn(guard(workspace, spec));

    const coreAfter = JSON.stringify(coreOf(workspace));
    if (coreAfter !== coreBefore) {
      // `balance` is duplicated as a plain field so it can be read in the Firebase console.
      tx.set(root, { data: coreAfter, balance: workspace.wallet.balance, updatedAt: sdk.FieldValue.serverTimestamp() });
    }
    for (const section of sections) {
      for (const { id: recordId, doc } of sectionEntries(workspace, section)) {
        const slot = `${section}/${recordId}`;
        if (before.get(slot) !== doc.json) tx.set(root.collection(section).doc(recordId), doc);
        before.delete(slot);
      }
    }
    // Loaded records that are gone from the workspace were deleted by `fn`.
    for (const slot of before.keys()) {
      const [section, recordId] = slot.split("/") as [Section, string];
      tx.delete(root.collection(section).doc(recordId));
    }
    return result;
  });
}

async function firestoreDoc<T, R>(collection: string, id: string, fn: (current: T | null) => { next: T | null; result: R } | Promise<{ next: T | null; result: R }>): Promise<R> {
  const { db, sdk } = await firestore();
  const ref = db.collection(collection).doc(docId(id));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (JSON.parse(String(snap.get("data"))) as T) : null;
    const { next, result } = await fn(current);
    if (next === null) {
      if (snap.exists) tx.delete(ref);
    } else {
      const json = JSON.stringify(next);
      if (!snap.exists || json !== snap.get("data")) tx.set(ref, { data: json, updatedAt: sdk.FieldValue.serverTimestamp() });
    }
    return result;
  });
}
