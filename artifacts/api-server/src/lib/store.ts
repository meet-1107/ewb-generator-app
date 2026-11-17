import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EwbInput } from "./validation";
import { bump, indexOf, takePending, type AccountCounts, type StatTotals, type UserIndex } from "./metrics";

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
 * `{ ewbs: [] }` none (new records can still be added), `{ ewbs: { since } }`
 * those changed after `since` (see `changedAt`). Touching a section that was
 * not named throws, on both backends.
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
  /** For the printed bill (EWB-01). Absent on bills generated before they were recorded. */
  documentType?: string;
  /** NIC transaction type: 1 regular, 2 bill to-ship to, 3 bill from-dispatch from, 4 both. */
  transactionType?: number;
  dispatch?: { place: string; state: string; pincode: string };
  delivery?: { place: string; state: string; pincode: string };
  /** The distance NIC used, when its reply says (it calculates it when 0 is sent). */
  nicDistanceKm?: number;
  createdAt: string;
  updatedAt: string;
  /**
   * When the server last saved a change to this bill, set by the store on every write
   * (and once on old bills when they are next loaded), so the list can send only what changed.
   */
  changedAt?: string;
};

export type EwbRequest = {
  id: string;
  idempotencyKey: string;
  invoiceId: string;
  /** "unknown": the provider call failed in a way that may or may not have created the bill; a retry reconciles it. */
  state: "pending" | "generated" | "rejected" | "unknown";
  ewbId?: string;
  safeErrorCode?: string;
  createdAt: string;
  /** When the current attempt claimed the request, and the credits it holds. */
  claimedAt?: string;
  holdId?: string;
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

export type WalletAction = "generate" | "part_b" | "consolidate" | "cancel" | "extend" | "gst_verify";
export type WalletEntry = {
  id: string;
  at: string;
  /** "adjust": a manual change by an administrator (reason in `note`, who in `actor`). */
  kind: WalletAction | "grant" | "topup" | "adjust";
  /** Signed: negative for charges, positive for grants/top-ups. */
  credits: number;
  /** "held" while the provider call runs; "charged" on success; "refunded" on failure. */
  status: "held" | "charged" | "refunded" | "credited";
  ewbNumber?: string;
  targetId?: string;
  note?: string;
  /** Administrator who made an "adjust" entry. */
  actor?: string;
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
  /** Billing invoice (lib/billing.ts), set once the payment is invoiced. */
  invoiceNumber?: string;
};

/** E-way bill portal API login for one GSTIN. The password is encrypted at rest. */
export type EwbCredential = { gstin: string; username: string; passwordEnc: string; updatedAt: string };

/** `updatedAt`: when the device made the change (newest wins). `receivedAt`: when the server stored it (what `since` compares). */
export type SyncRecord = { id: string; updatedAt: string; receivedAt?: string; deleted?: boolean; data?: unknown };

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
  /** GSTIN whose free trial credits this account received (lib/welcome.ts). */
  welcomeGstin?: string;
  /** GSTINs this account was first to look up on the GST network, and when (routes/gstin.ts): the free ones and the paid ones. */
  gstLookups?: Record<string, string>;
  audit: { at: string; actor: string; action: string; targetId: string; outcome: string }[];
  sync: Record<string, Record<string, SyncRecord>>;
  /** The newest notifications, oldest first (lib/notify.ts). */
  notices?: Notice[];
  /** Per GSTIN: the last login the portal refused (a keyed fingerprint, never the password). */
  refusedLogins?: Record<string, { fingerprint: string; at: string }>;
  /** Counts for the admin panel (lib/metrics.ts). */
  counts?: AccountCounts;
  /** Business name and GSTIN, copied from the synced business profile for the user index. */
  profile?: { businessName: string | null; gstin: string | null };
  /** FCM registration tokens of the user's devices, with when each was last seen. */
  pushTokens?: Record<string, { platform: string; updatedAt: string }>;
};

/** A notification shown under the bell and sent to the user's phones. `route` says where a tap opens. */
export type Notice = {
  id: string;
  at: string;
  kind: "credits" | "payment" | "ewb" | "support";
  title: string;
  body: string;
  route: "wallet" | "ewb" | "support";
  /** The e-way bill (record id) for route "ewb". */
  targetId?: string;
  read?: boolean;
  /** Sent to the devices (or there were none to send to). */
  pushed?: boolean;
};


export const SECTIONS = ["ewbs", "requests", "gst", "cewbs", "sync"] as const;
export type Section = (typeof SECTIONS)[number];
/**
 * Which records of each large section a call needs. `sync` is loaded whole
 * ("all"), or as the records named in `keys` ("collection/id") plus every
 * record changed after `since`, so a sync reads only what changed.
 */
export type SyncSpec = "all" | { keys: string[]; since?: string };
/** E-way bills changed after `since` (their `changedAt`). */
export type ChangedSpec = { since: string };
export type SectionSpec = { [K in Exclude<Section, "sync" | "ewbs">]?: "all" | string[] } & { ewbs?: "all" | string[] | ChangedSpec; sync?: SyncSpec };

/**
 * Stamps `changedAt` on every e-way bill that is new, changed by this call, or has none yet.
 * `before` is the bill's stored JSON (undefined when it was not stored or not loaded).
 */
function stampChangedEwbs(ewbs: Record<string, EwbRecord>, before: (key: string) => string | undefined, now: string) {
  for (const [key, record] of Object.entries(ewbs)) {
    if (!record.changedAt || before(key) !== JSON.stringify(record)) record.changedAt = now;
  }
}
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

/** Every document of a small shared collection (e.g. support threads), unlocked. */
export async function listDocs<T>(collection: string): Promise<T[]> {
  if (backend === "file") {
    const dir = path.join(dataDir, collection);
    let names: string[] = [];
    try {
      names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as T));
  }
  const { db } = await firestore();
  return (await db.collection(collection).get()).docs.map((snap) => JSON.parse(String(snap.get("data"))) as T);
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
    const isNew = !fileExists.has(id) && !(await pathExists(workspaceFile(id)));
    const stored = await loadFile(id);
    const workspace = structuredClone(stored);
    const indexBefore = isNew ? null : JSON.stringify(indexOf(stored));
    const result = await fn(guard(workspace, spec));
    stampChangedEwbs(workspace.ewbs, (key) => (stored.ewbs[key] ? JSON.stringify(stored.ewbs[key]) : undefined), new Date().toISOString());
    if (isNew) bump(workspace, "signups");
    const stats = takePending(workspace);
    await writeJson(workspaceFile(id), workspace);
    fileExists.add(id);
    cache.set(id, workspace);
    const index = indexOf(workspace);
    if (JSON.stringify(index) !== indexBefore) await writeJson(path.join(dataDir, "user_index", `${id}.json`), index);
    for (const [docName, fields] of stats) await fileDoc<Partial<StatTotals>, null>("stats", docName, (current) => ({ next: addTotals(current ?? {}, fields), result: null }));
    return result;
  });
  queues.set(id, next);
  return next;
}

const fileExists = new Set<string>();

async function pathExists(file: string) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

function addTotals(current: Partial<StatTotals>, fields: Partial<StatTotals>) {
  const next = { ...current };
  for (const [key, n] of Object.entries(fields) as [keyof StatTotals, number][]) next[key] = (next[key] ?? 0) + n;
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

/** One stored record of a large section. `name` is the sync collection, for `sync` only; `changedAt` is queried, for `ewbs` only. */
type RecordDoc = { key: string; name?: string; json: string; updatedAt?: string; changedAt?: string };

function sectionEntries(workspace: Workspace, section: Section): { id: string; doc: RecordDoc }[] {
  if (section === "sync") {
    return Object.entries(workspace.sync).flatMap(([name, records]) =>
      Object.entries(records).map(([key, record]) => ({ id: docId(`${name}/${key}`), doc: { key, name, json: JSON.stringify(record), updatedAt: record.receivedAt ?? record.updatedAt } })),
    );
  }
  if (section === "ewbs") {
    return Object.entries(workspace.ewbs).map(([key, record]) => ({ id: docId(key), doc: { key, json: JSON.stringify(record), ...(record.changedAt ? { changedAt: record.changedAt } : {}) } }));
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
      if (!Array.isArray(wanted) && !("keys" in wanted)) {
        // ewbs: only the bills changed after `since`.
        return (await tx.get(root.collection(section).where("changedAt", ">", wanted.since))).docs;
      }
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

    const indexBefore = coreBefore ? JSON.stringify(indexOf(workspace)) : null;
    const result = await fn(guard(workspace, spec));
    if (spec.ewbs !== undefined) stampChangedEwbs(workspace.ewbs, (key) => before.get(`ewbs/${docId(key)}`), new Date().toISOString());
    // The first write of an account is its sign-up.
    if (!coreBefore) bump(workspace, "signups");
    const stats = takePending(workspace);

    const coreAfter = JSON.stringify(coreOf(workspace));
    if (coreAfter !== coreBefore) {
      // `balance` is duplicated as a plain field so it can be read in the Firebase console.
      tx.set(root, { data: coreAfter, balance: workspace.wallet.balance, updatedAt: sdk.FieldValue.serverTimestamp() });
      // The Users page reads this small document, never the whole account.
      const index = indexOf(workspace);
      if (JSON.stringify(index) !== indexBefore) tx.set(db.collection("user_index").doc(id), index);
      for (const [docName, fields] of stats) {
        tx.set(db.collection("stats").doc(docName), Object.fromEntries(Object.entries(fields).map(([key, n]) => [key, sdk.FieldValue.increment(n as number)])), { merge: true });
      }
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

/* ---------- Read-only views and append-only logs (admin panel) ---------- */

/** What `peekWorkspace` loads besides the small fields. */
/** syncNames: every record of these sync collections (e.g. "invoices" for the admin's invoice counts). */
export type PeekSpec = { ewbs?: boolean; requests?: boolean; syncKeys?: string[]; syncNames?: string[] };

/** Every workspace that has been created, by id. */
export async function listWorkspaceIds(): Promise<string[]> {
  if (backend === "file") {
    try {
      return (await readdir(path.join(dataDir, "workspaces"))).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  const { db } = await firestore();
  return (await db.collection("workspaces").listDocuments()).map((ref) => ref.id);
}

/**
 * A snapshot of a workspace for reading only: no lock, no transaction, never
 * written back, and null (not a fresh workspace) when it does not exist.
 * Sections that were not asked for are empty.
 */
export async function peekWorkspace(id: string, spec: PeekSpec = {}): Promise<Workspace | null> {
  if (backend === "file") {
    const cached = cache.get(id);
    if (!cached) {
      try {
        await readFile(workspaceFile(id), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }
    const full = structuredClone(await loadFile(id));
    const syncKeys = new Set(spec.syncKeys ?? []);
    const sync: Workspace["sync"] = {};
    for (const key of syncKeys) {
      const [name, recordId] = key.split("/") as [string, string];
      const record = full.sync[name]?.[recordId];
      if (record) (sync[name] ??= {})[recordId] = record;
    }
    for (const name of spec.syncNames ?? []) if (full.sync[name]) sync[name] = { ...sync[name], ...full.sync[name] };
    return { ...full, ewbs: spec.ewbs ? full.ewbs : {}, requests: spec.requests ? full.requests : {}, gst: {}, cewbs: {}, sync };
  }
  const { db } = await firestore();
  const root = db.collection("workspaces").doc(id);
  const snap = await root.get();
  if (!snap.exists) return null;
  const workspace: Workspace = { ...freshWorkspace(id), ...(JSON.parse(String(snap.get("data"))) as Core) };
  const records = (docs: { data(): unknown }[]) => docs.map((doc) => doc.data() as RecordDoc);
  if (spec.ewbs) for (const doc of records((await root.collection("ewbs").get()).docs)) workspace.ewbs[doc.key] = JSON.parse(doc.json) as EwbRecord;
  if (spec.requests) for (const doc of records((await root.collection("requests").get()).docs)) workspace.requests[doc.key] = JSON.parse(doc.json) as EwbRequest;
  if (spec.syncKeys?.length) {
    const snaps = await db.getAll(...spec.syncKeys.map((key) => root.collection("sync").doc(docId(key))));
    for (const item of snaps) {
      if (!item.exists) continue;
      const doc = item.data() as RecordDoc;
      (workspace.sync[doc.name!] ??= {})[doc.key] = JSON.parse(doc.json) as SyncRecord;
    }
  }
  if (spec.syncNames?.length) {
    for (const doc of records((await root.collection("sync").where("name", "in", spec.syncNames).get()).docs)) (workspace.sync[doc.name!] ??= {})[doc.key] = JSON.parse(doc.json) as SyncRecord;
  }
  return workspace;
}

/** Append-only logs. Records are never updated or deleted by the app. */
export type LogCollection = "api_calls" | "payment_events" | "admin_audit" | "app_opens" | "payment_steps";
export type LogRecord = Record<string, unknown> & { at: string };

export async function appendLog(collection: LogCollection, record: LogRecord): Promise<void> {
  if (backend === "file") {
    const file = path.join(dataDir, "logs", `${collection}.jsonl`);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`);
    return;
  }
  const { db, sdk } = await firestore();
  // `expireAt`: a Firestore TTL policy on this field deletes old log rows by itself (no read, no cost to our code).
  await db.collection(collection).add({ ...record, expireAt: sdk.Timestamp.fromMillis(Date.parse(record.at) + LOG_RETENTION_DAYS[collection] * 86_400_000) });
}

/** How long each log is kept before the TTL policy removes it. */
const LOG_RETENTION_DAYS: Record<LogCollection, number> = { api_calls: 120, app_opens: 120, payment_steps: 180, payment_events: 400, admin_audit: 730 };

/** Log records with `at` in [from, to], newest first, at most `limit`. */
export async function queryLogs(collection: LogCollection, { from, to, limit }: { from?: string; to?: string; limit: number }): Promise<LogRecord[]> {
  const inRange = (record: LogRecord) => (!from || record.at >= from) && (!to || record.at <= to);
  if (backend === "file") {
    let text = "";
    try {
      text = await readFile(path.join(dataDir, "logs", `${collection}.jsonl`), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogRecord).filter(inRange).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
  const { db } = await firestore();
  let query: import("firebase-admin/firestore").Query = db.collection(collection);
  if (from) query = query.where("at", ">=", from);
  if (to) query = query.where("at", "<=", to);
  const snap = await query.orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((doc) => doc.data() as LogRecord);
}


/* ---------- Admin counters and user index (lib/metrics.ts) ---------- */

/** Counter shard documents by id (missing ones are skipped). */
export async function readStats(ids: string[]): Promise<Partial<StatTotals>[]> {
  if (!ids.length) return [];
  if (backend === "file") {
    const docs = await Promise.all(ids.map((id) => readFile(path.join(dataDir, "stats", `${id}.json`), "utf8").then((text) => JSON.parse(text) as Partial<StatTotals>).catch(() => null)));
    return docs.filter((doc): doc is Partial<StatTotals> => Boolean(doc));
  }
  const { db } = await firestore();
  const snaps = [];
  // getAll in batches of 300 (a month of days × shards is 300 documents).
  for (let start = 0; start < ids.length; start += 300) snaps.push(...(await db.getAll(...ids.slice(start, start + 300).map((id) => db.collection("stats").doc(id)))));
  return snaps.filter((snap) => snap.exists).map((snap) => snap.data() as Partial<StatTotals>);
}

/** Replaces counter documents (the one-time rebuild). */
export async function writeStats(docs: Map<string, Partial<StatTotals>>, { merge = false } = {}) {
  if (backend === "file") {
    for (const [id, fields] of docs) await fileDoc<Partial<StatTotals>, null>("stats", id, (current) => ({ next: merge ? addTotals(current ?? {}, fields) : fields, result: null }));
    return;
  }
  const { db, sdk } = await firestore();
  const entries = [...docs.entries()];
  for (let start = 0; start < entries.length; start += 400) {
    const batch = db.batch();
    for (const [id, fields] of entries.slice(start, start + 400)) {
      const ref = db.collection("stats").doc(id);
      if (merge) batch.set(ref, Object.fromEntries(Object.entries(fields).map(([key, n]) => [key, sdk.FieldValue.increment(n as number)])), { merge: true });
      else batch.set(ref, fields);
    }
    await batch.commit();
  }
}

/** Deletes every counter document (before a rebuild). */
export async function clearStats() {
  if (backend === "file") {
    await rm(path.join(dataDir, "stats"), { recursive: true, force: true });
    return;
  }
  const { db } = await firestore();
  for (;;) {
    const page = await db.collection("stats").limit(400).get();
    if (page.empty) return;
    const batch = db.batch();
    for (const snap of page.docs) batch.delete(snap.ref);
    await batch.commit();
  }
}

export type IndexQuery = {
  /** One filter at most (Firestore orders by the filtered field, so no composite index is needed). */
  where?: { field: keyof UserIndex; op: "==" | ">" | "<" | ">=" | "<="; value: string | number | boolean | null };
  orderBy: keyof UserIndex;
  direction: "asc" | "desc";
  limit: number;
  /** The uid of the last row of the previous page. */
  after?: string;
};

const compare = (a: unknown, b: unknown) => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : a < b ? -1 : 1);
const matches = (value: unknown, op: string, target: unknown) => (op === "==" ? value === target : op === ">" ? compare(value, target) > 0 : op === "<" ? compare(value, target) < 0 : op === ">=" ? compare(value, target) >= 0 : compare(value, target) <= 0);

/** One page of the user index, and how many accounts match the filter. */
export async function queryUserIndex(query: IndexQuery): Promise<{ rows: UserIndex[]; total: number; next: string | null }> {
  const orderBy = query.where && query.where.op !== "==" ? query.where.field : query.orderBy;
  if (backend === "file") {
    let all: UserIndex[] = [];
    try {
      const dir = path.join(dataDir, "user_index");
      all = await Promise.all((await readdir(dir)).filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as UserIndex));
    } catch { /* none yet */ }
    const filtered = query.where ? all.filter((row) => matches(row[query.where!.field], query.where!.op, query.where!.value)) : all;
    const sign = query.direction === "desc" ? -1 : 1;
    filtered.sort((a, b) => sign * (compare(a[orderBy], b[orderBy]) || compare(a.uid, b.uid)));
    const start = query.after ? filtered.findIndex((row) => row.uid === query.after) + 1 : 0;
    const rows = filtered.slice(start, start + query.limit);
    return { rows, total: filtered.length, next: start + rows.length < filtered.length ? rows.at(-1)?.uid ?? null : null };
  }
  const { db } = await firestore();
  let base: import("firebase-admin/firestore").Query = db.collection("user_index");
  if (query.where) base = base.where(query.where.field, query.where.op, query.where.value);
  const total = (await base.count().get()).data().count;
  if (!query.limit) return { rows: [], total, next: null };
  let page = base.orderBy(orderBy, query.direction);
  if (query.after) {
    const cursor = await db.collection("user_index").doc(query.after).get();
    if (cursor.exists) page = page.startAfter(cursor);
  }
  const snaps = await page.limit(query.limit + 1).get();
  const rows = snaps.docs.slice(0, query.limit).map((snap) => snap.data() as UserIndex);
  return { rows, total, next: snaps.docs.length > query.limit ? rows.at(-1)?.uid ?? null : null };
}

/** Writes an account's index document directly (the one-time rebuild). */
export async function writeUserIndex(index: UserIndex) {
  if (backend === "file") return writeJson(path.join(dataDir, "user_index", `${index.uid}.json`), index);
  const { db } = await firestore();
  await db.collection("user_index").doc(index.uid).set(index);
}

/** Workspace ids in pages (the one-time rebuild). */
export async function workspaceIdPage(after: string | undefined, limit: number): Promise<string[]> {
  if (backend === "firestore") {
    // Only this page of accounts is read (no listing of every account per page).
    const { db, sdk } = await firestore();
    let query = db.collection("workspaces").orderBy(sdk.FieldPath.documentId()).select().limit(limit);
    if (after) query = query.startAfter(after);
    return (await query.get()).docs.map((snap) => snap.id);
  }
  const ids = (await listWorkspaceIds()).sort();
  const start = after ? ids.findIndex((id) => id > after) : 0;
  return start < 0 ? [] : ids.slice(start, start + limit);
}
