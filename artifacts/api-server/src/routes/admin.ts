import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { adminAudit, ADMIN_ROLES, allow, bootstrapEmails, can, forgetRole, maskEmail, maskGstin, PERMISSIONS, recentSignIn, requireAdmin, ROLE_LABELS, type AdminIdentity } from "../lib/admin-auth";
import { activity, apiCalls, inRange, invalidateSnapshot, overview, providerQuota, reconcile, snapshot, summarizeApi, type EwbRow, type PurchaseRow, type Range, type UserRow } from "../lib/admin-data";
import { directory } from "../lib/admin-directory";
import { authMode } from "../lib/auth";
import { distanceConfigured } from "../lib/distance";
import { gstinApiConfigured, gstinApiTestMode } from "../lib/gstinapi";
import { creditPacks, creditPricePaise, fetchPaymentLink, razorpayConfigured } from "../lib/payments";
import { billingMode } from "../lib/plans";
import { rateLimit } from "../lib/rate-limit";
import { peekWorkspace, queryLogs, withWorkspace } from "../lib/store";
import { setSuspended } from "../lib/suspensions";
import { adjustCredits, creditCosts, walletSummary } from "../lib/wallet";
import { ewbProvider, ewbProviderSetting } from "../providers/ewb-provider";
import { settlePurchase } from "./wallet";
import { issueBillingInvoice } from "../lib/billing";

/**
 * Admin panel API, under /api/admin (the panel itself is /admin on Hosting).
 * Every route needs a signed-in admin (requireAdmin) and the permission named
 * on it (allow). Reads come from the shared snapshot; changes go through the
 * same ledger and transactions as the app, and each one is audited.
 */
const router: IRouter = Router();
router.use(rateLimit({ windowMs: 60_000, max: 300 }));
router.use(requireAdmin);
const sensitive = rateLimit({ windowMs: 10 * 60_000, max: 30, by: "workspace" });

/* ---------- Helpers ---------- */

function rangeOf(req: Request): Range {
  const parse = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);
  const to = parse(req.query["to"]) ?? new Date().toISOString();
  const from = parse(req.query["from"]) ?? new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
  return { from, to };
}

function page<T>(req: Request, items: T[]) {
  const size = Math.min(100, Math.max(1, Number(req.query["pageSize"] ?? 25) || 25));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pages, Math.max(1, Number(req.query["page"] ?? 1) || 1));
  return { items: items.slice((current - 1) * size, current * size), page: current, pageSize: size, total, pages };
}

/** A route parameter as one string. */
const param = (req: Request, key: string) => String(req.params[key] ?? "");

const text = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string).trim() : "");

function sortBy<T>(items: T[], key: (item: T) => string | number | null, dir: "asc" | "desc") {
  return [...items].sort((a, b) => {
    const x = key(a) ?? "";
    const y = key(b) ?? "";
    return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1);
  });
}

/** What an admin without the `pii` permission sees of a person. */
function userView(admin: AdminIdentity, user: UserRow) {
  if (can(admin, "pii")) return user;
  return { ...user, email: maskEmail(user.email), name: user.name ? `${user.name.slice(0, 1)}•••` : null, gstin: maskGstin(user.gstin) };
}

function ewbView(admin: AdminIdentity, ewb: EwbRow, users: Map<string, UserRow>) {
  const user = users.get(ewb.uid);
  const pii = can(admin, "pii");
  return { ...ewb, userEmail: pii ? user?.email ?? null : maskEmail(user?.email ?? null), businessName: user?.businessName ?? null, sellerGstin: pii ? ewb.sellerGstin : maskGstin(ewb.sellerGstin), buyerName: pii ? ewb.buyerName : "•••" };
}

function purchaseView(purchase: PurchaseRow, users: Map<string, UserRow>) {
  const user = users.get(purchase.uid);
  return { ...purchase, shortUrl: undefined, userEmail: user?.email ?? null, userName: user?.name ?? null };
}

function csv(res: Response, name: string, rows: Record<string, unknown>[]) {
  const columns = rows.length ? Object.keys(rows[0]!) : [];
  // Cells that start like a formula are prefixed so spreadsheets do not run them.
  const cell = (value: unknown) => {
    let out = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
    return /[",\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
  };
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\r\n"));
}

const userIndex = (users: UserRow[]) => new Map(users.map((user) => [user.uid, user]));

/* ---------- Session ---------- */

router.get("/me", async (req, res) => {
  const admin = req.admin!;
  await adminAudit(req, { action: "admin.session", outcome: "ok" });
  res.json({ uid: admin.uid, email: admin.email, role: admin.role, roleLabel: ROLE_LABELS[admin.role], bootstrap: admin.bootstrap, permissions: admin.permissions, authTime: admin.authTime });
});

/* ---------- Overview ---------- */

router.get("/overview", allow("overview"), async (req, res) => {
  const data = await overview(rangeOf(req));
  const admin = req.admin!;
  const users = userIndex((await snapshot()).users);
  res.json({
    ...data,
    api: can(admin, "api") ? data.api : null,
    quota: can(admin, "api") || can(admin, "health") ? data.quota : null,
    payments: can(admin, "payments") ? data.payments : null,
    credits: can(admin, "credits") ? data.credits : null,
    recent: {
      payments: can(admin, "payments") ? data.recent.payments.map((purchase) => purchaseView(purchase as PurchaseRow, users)) : [],
      ewbs: data.recent.ewbs.map((ewb) => ewbView(admin, ewb, users)),
      admin: can(admin, "audit") ? data.recent.admin : [],
    },
  });
});

/* ---------- App activity ---------- */

router.get("/activity", allow("users"), async (req, res) => {
  const data = await activity(rangeOf(req));
  const pii = can(req.admin!, "pii");
  res.json({
    ...data,
    users: data.users.map((user) => (pii ? user : { ...user, email: maskEmail(user.email), name: user.name ? `${user.name.slice(0, 1)}•••` : null, gstin: maskGstin(user.gstin) })),
  });
});

/* ---------- Users ---------- */

function filterUsers(req: Request, users: UserRow[]) {
  const q = text(req, "q").toLowerCase();
  const status = text(req, "status");
  const verified = text(req, "verified");
  const paid = text(req, "paid");
  const bills = text(req, "bills");
  const credits = text(req, "credits");
  const range = text(req, "from") || text(req, "to") ? rangeOf(req) : null;
  return users.filter((user) => {
    if (q && ![user.uid, user.email, user.name, user.businessName, user.gstin].some((value) => value?.toLowerCase().includes(q))) return false;
    if (status === "active" && (user.suspended || user.disabled)) return false;
    if (status === "suspended" && !(user.suspended || user.disabled)) return false;
    if (verified === "yes" && !user.emailVerified) return false;
    if (verified === "no" && user.emailVerified) return false;
    if (paid === "yes" && !user.paidPayments) return false;
    if (paid === "no" && user.paidPayments) return false;
    if (bills === "yes" && !user.ewbTotal) return false;
    if (bills === "no" && user.ewbTotal) return false;
    if (credits === "low" && user.balance > creditCosts.generate * 2) return false;
    if (credits === "zero" && user.balance > 0) return false;
    if (range && !inRange(user.createdAt, range)) return false;
    return true;
  });
}

const USER_SORT: Record<string, (user: UserRow) => string | number | null> = {
  createdAt: (user) => user.createdAt,
  lastSignInAt: (user) => user.lastSignInAt,
  balance: (user) => user.balance,
  ewbTotal: (user) => user.ewbTotal,
  paidPaise: (user) => user.paidPaise,
  email: (user) => user.email,
};

router.get("/users", allow("users"), async (req, res) => {
  const snap = await snapshot(req.query["fresh"] === "1");
  let users = filterUsers(req, snap.users);
  // Searching by an e-way bill number or payment reference finds its owner.
  const q = text(req, "q");
  if (q && can(req.admin!, "pii")) {
    const owners = new Set([...snap.ewbs.filter((ewb) => ewb.ewbNumber === q).map((ewb) => ewb.uid), ...snap.purchases.filter((purchase) => purchase.id === q || purchase.paymentId === q).map((purchase) => purchase.uid)]);
    if (owners.size) users = snap.users.filter((user) => owners.has(user.uid));
  }
  const key = USER_SORT[text(req, "sort")] ?? USER_SORT["createdAt"]!;
  const sorted = sortBy(users, key, text(req, "dir") === "asc" ? "asc" : "desc");
  const result = page(req, sorted);
  res.json({ ...result, items: result.items.map((user) => userView(req.admin!, user)), builtAt: snap.builtAt });
});

router.get("/users/:uid", allow("users"), async (req, res) => {
  const admin = req.admin!;
  const snap = await snapshot(req.query["fresh"] === "1");
  const user = snap.users.find((item) => item.uid === param(req, "uid"));
  if (!user) return res.status(404).json({ error: "not_found", message: "No such user." });
  const workspace = await peekWorkspace(user.uid, { ewbs: true, requests: true, syncKeys: ["business/profile"] });
  const calls = can(admin, "api") ? (await queryLogs("api_calls", { from: new Date(Date.now() - 90 * 86_400_000).toISOString(), limit: 20_000 })).filter((call) => call["workspaceId"] === user.uid) : null;
  const users = userIndex(snap.users);
  // Document locks share the requests section; only real submissions are counted.
  const requests = Object.values(workspace?.requests ?? {}).filter((request) => !request.idempotencyKey.startsWith("doc|") && workspace?.requests[request.idempotencyKey] === request);
  await adminAudit(req, { action: "admin.user.view", target: user.uid, outcome: "ok" });
  return res.json({
    user: userView(admin, user),
    business: can(admin, "pii") ? workspace?.sync["business"]?.["profile"]?.data ?? null : null,
    subscription: workspace?.subscription ?? null,
    wallet: can(admin, "credits") && workspace ? { ...walletSummary(workspace), ledger: [...workspace.wallet.ledger].reverse() } : null,
    purchases: can(admin, "payments") ? Object.values(workspace?.purchases ?? {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((purchase) => purchaseView({ ...purchase, uid: user.uid }, users)) : null,
    ewbs: snap.ewbs.filter((ewb) => ewb.uid === user.uid).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).map((ewb) => ewbView(admin, ewb, users)),
    attempts: {
      generated: requests.filter((request) => request.state === "generated").length,
      rejected: requests.filter((request) => request.state === "rejected").length,
      unknown: requests.filter((request) => request.state === "unknown").length,
      pending: requests.filter((request) => request.state === "pending").length,
    },
    api: calls ? { ...summarizeApi(calls), recent: calls.slice(0, 50) } : null,
    portalLogins: Object.values(workspace?.ewbCredentials ?? {}).map((credential) => ({ gstin: can(admin, "pii") ? credential.gstin : maskGstin(credential.gstin), updatedAt: credential.updatedAt })),
    audit: can(admin, "audit") ? { workspace: [...(workspace?.audit ?? [])].reverse().slice(0, 100), admin: (await queryLogs("admin_audit", { limit: 5000 })).filter((event) => event["target"] === user.uid).slice(0, 100) } : null,
  });
});

const adjustSchema = z.object({
  credits: z.number().int().min(-100_000).max(100_000).refine((value) => value !== 0, "Enter a non-zero amount."),
  reason: z.string().trim().min(5).max(200),
  reference: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

router.post("/users/:uid/credits", allow("credits.adjust"), recentSignIn(), sensitive, async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Enter a whole, non-zero number of credits and a reason (at least 5 characters)." });
  const uid = param(req, "uid");
  const exists = (await directory().get(uid)) || (await peekWorkspace(uid));
  if (!exists) return res.status(404).json({ error: "not_found", message: "No such user." });
  const admin = req.admin!;
  const result = await withWorkspace(uid, (workspace) => {
    const before = workspace.wallet.balance;
    const outcome = adjustCredits(workspace, { ...parsed.data, actor: `${admin.email} (${admin.uid})` });
    if (outcome.ok && !outcome.replay) workspace.audit.push({ at: new Date().toISOString(), actor: `admin:${admin.uid}`, action: "wallet.adjust", targetId: outcome.entry.id, outcome: String(parsed.data.credits) });
    return { ...outcome, before };
  });
  if (!result.ok) {
    await adminAudit(req, { action: "admin.credits.adjust", target: uid, outcome: "refused_negative", reason: parsed.data.reason, before: { balance: result.balance }, after: { credits: parsed.data.credits } });
    return res.status(409).json({ error: "negative_balance", message: `This would take the balance below zero (it is ${result.balance}).` });
  }
  if (!result.replay) {
    await adminAudit(req, { action: "admin.credits.adjust", target: uid, outcome: "ok", reason: parsed.data.reason, before: { balance: result.before }, after: { balance: result.balance, entryId: result.entry.id, credits: parsed.data.credits } });
    invalidateSnapshot();
  }
  return res.json({ entry: result.entry, balance: result.balance, replay: result.replay });
});

router.post("/users/:uid/suspension", allow("users.suspend"), recentSignIn(), sensitive, async (req, res) => {
  const parsed = z.object({ suspended: z.boolean(), reason: z.string().trim().min(5).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Give a reason (at least 5 characters)." });
  const uid = param(req, "uid");
  if (uid === req.admin!.uid) return res.status(409).json({ error: "self", message: "You cannot suspend your own account." });
  const account = await directory().get(uid);
  if (!account) return res.status(404).json({ error: "not_found", message: "No such account." });
  if (account.email && bootstrapEmails.has(account.email.toLowerCase())) return res.status(409).json({ error: "protected", message: "A bootstrap super admin cannot be suspended here." });
  await setSuspended(uid, parsed.data.suspended, req.admin!.uid, parsed.data.reason);
  await directory().setDisabled(uid, parsed.data.suspended);
  await adminAudit(req, { action: parsed.data.suspended ? "admin.user.suspend" : "admin.user.reactivate", target: uid, outcome: "ok", reason: parsed.data.reason, before: { disabled: account.disabled }, after: { disabled: parsed.data.suspended } });
  invalidateSnapshot();
  return res.json({ uid, suspended: parsed.data.suspended });
});

/* ---------- E-way bills ---------- */

function filterEwbs(req: Request, ewbs: EwbRow[], users: Map<string, UserRow>) {
  const q = text(req, "q").toLowerCase();
  const status = text(req, "status");
  const uid = text(req, "uid");
  const provider = text(req, "provider");
  const range = text(req, "from") || text(req, "to") ? rangeOf(req) : null;
  return ewbs.filter((ewb) => {
    if (uid && ewb.uid !== uid) return false;
    if (provider && ewb.provider !== provider) return false;
    if (status && ewb.status !== status) return false;
    if (range && !inRange(ewb.generatedAt, range)) return false;
    if (q) {
      const user = users.get(ewb.uid);
      if (![ewb.ewbNumber, ewb.invoiceNumber, ewb.buyerName, ewb.sellerGstin, user?.email, user?.businessName].some((value) => value?.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

router.get("/ewbs", allow("ewbs"), async (req, res) => {
  const snap = await snapshot(req.query["fresh"] === "1");
  const users = userIndex(snap.users);
  const rows = sortBy(filterEwbs(req, snap.ewbs, users), (ewb) => ewb.generatedAt, "desc");
  const result = page(req, rows);
  res.json({ ...result, items: result.items.map((ewb) => ewbView(req.admin!, ewb, users)), builtAt: snap.builtAt });
});

router.get("/ewbs/:uid/:id", allow("ewbs"), async (req, res) => {
  const admin = req.admin!;
  const workspace = await peekWorkspace(param(req, "uid"), { ewbs: true, requests: true });
  const ewb = workspace?.ewbs[param(req, "id")];
  if (!workspace || !ewb) return res.status(404).json({ error: "not_found", message: "No such e-way bill." });
  const pii = can(admin, "pii");
  const calls = can(admin, "api") ? (await queryLogs("api_calls", { from: new Date(Date.parse(ewb.generatedAt) - 86_400_000).toISOString(), limit: 20_000 })).filter((call) => call["workspaceId"] === param(req, "uid") && (call["invoiceId"] === ewb.invoiceId || call["ewbNumber"] === ewb.ewbNumber)) : null;
  return res.json({
    ewb: pii ? ewb : { ...ewb, buyerName: "•••", buyerGstin: maskGstin(ewb.buyerGstin), sellerGstin: maskGstin(ewb.sellerGstin), lines: [], transport: { ...ewb.transport, vehicleNumber: "•••" } },
    requests: Object.values(workspace.requests).filter((request) => request.invoiceId === ewb.invoiceId && !request.idempotencyKey.startsWith("doc|")),
    ledger: can(admin, "credits") ? workspace.wallet.ledger.filter((entry) => entry.targetId === ewb.id || entry.ewbNumber === ewb.ewbNumber) : null,
    apiCalls: calls,
  });
});

/* ---------- API usage ---------- */

router.get("/api-usage", allow("api"), async (req, res) => {
  const range = rangeOf(req);
  const { records, capped } = await apiCalls(range);
  const operation = text(req, "operation");
  const outcome = text(req, "outcome");
  const provider = text(req, "provider");
  const uid = text(req, "uid");
  const filtered = records.filter((record) => (!operation || record["operation"] === operation) && (!provider || record["provider"] === provider) && (!uid || record["workspaceId"] === uid) && (!outcome || (outcome === "failed" ? record["outcome"] !== "ok" : record["outcome"] === outcome)));
  const hourly = new Map<string, number>();
  // Hour buckets in India time ("2026-10-11T14").
  const istHour = (at: string) => new Date(Date.parse(at) + 5.5 * 3_600_000).toISOString().slice(0, 13);
  for (const record of filtered) hourly.set(istHour(record.at), (hourly.get(istHour(record.at)) ?? 0) + 1);
  res.json({
    range,
    capped,
    summary: summarizeApi(filtered),
    peakHour: [...hourly.entries()].sort((a, b) => b[1] - a[1])[0] ?? null,
    quota: await providerQuota(),
    calls: page(req, filtered),
  });
});

/* ---------- Payments and credits ---------- */

router.get("/payments", allow("payments"), async (req, res) => {
  const snap = await snapshot(req.query["fresh"] === "1");
  const users = userIndex(snap.users);
  const status = text(req, "status");
  const provider = text(req, "provider");
  const q = text(req, "q").toLowerCase();
  const range = text(req, "from") || text(req, "to") ? rangeOf(req) : null;
  const rows = snap.purchases.filter((purchase) => {
    if (status && purchase.status !== status) return false;
    if (provider && purchase.provider !== provider) return false;
    if (range && !inRange(purchase.paidAt ?? purchase.createdAt, range)) return false;
    if (q && ![purchase.id, purchase.paymentId, users.get(purchase.uid)?.email, users.get(purchase.uid)?.name].some((value) => value?.toLowerCase().includes(q))) return false;
    return true;
  });
  const real = rows.filter((purchase) => purchase.provider === "razorpay");
  const result = page(req, sortBy(rows, (purchase) => purchase.paidAt ?? purchase.createdAt, "desc"));
  res.json({
    ...result,
    items: result.items.map((purchase) => purchaseView(purchase, users)),
    totals: {
      paidCount: real.filter((purchase) => purchase.status === "paid").length,
      grossPaise: real.filter((purchase) => purchase.status === "paid").reduce((total, purchase) => total + purchase.amountPaise, 0),
      pending: real.filter((purchase) => purchase.status === "created").length,
      expiredOrCancelled: real.filter((purchase) => purchase.status === "expired" || purchase.status === "cancelled").length,
    },
    builtAt: snap.builtAt,
  });
});

router.get("/payments/:uid/:id", allow("payments"), async (req, res) => {
  const workspace = await peekWorkspace(param(req, "uid"));
  const purchase = workspace?.purchases[param(req, "id")];
  if (!workspace || !purchase) return res.status(404).json({ error: "not_found", message: "No such payment." });
  const events = (await queryLogs("payment_events", { from: purchase.createdAt, limit: 5000 })).filter((event) => event["linkId"] === purchase.id);
  return res.json({
    purchase: { ...purchase, shortUrl: undefined },
    credits: workspace.wallet.ledger.filter((entry) => entry.kind === "topup" && (entry.targetId === purchase.id || (purchase.paymentId && entry.note?.includes(purchase.paymentId)))),
    events,
  });
});

/** Asks Razorpay for the link's real status and settles it if paid (credits once, like the webhook). */
router.post("/payments/:uid/:id/recheck", allow("payments.recheck"), sensitive, async (req, res) => {
  const workspace = await peekWorkspace(param(req, "uid"));
  const purchase = workspace?.purchases[param(req, "id")];
  if (!workspace || !purchase) return res.status(404).json({ error: "not_found", message: "No such payment." });
  if (purchase.provider !== "razorpay") return res.status(409).json({ error: "not_razorpay", message: "Only Razorpay payments can be re-checked." });
  if (!razorpayConfigured) return res.status(503).json({ error: "payments_off", message: "Razorpay is not configured on the server." });
  let link;
  try {
    link = await fetchPaymentLink(purchase.id);
  } catch (error) {
    await adminAudit(req, { action: "admin.payment.recheck", target: purchase.id, outcome: "gateway_error" });
    return res.status(502).json({ error: "gateway_error", message: `Razorpay did not answer: ${(error as Error).message}` });
  }
  const outcome = await withWorkspace(param(req, "uid"), (current) => {
    const record = current.purchases[purchase.id]!;
    const before = record.status;
    if (link.status === "paid" && link.amountPaid >= record.amountPaise) return { before, credited: settlePurchase(current, purchase.id, link.paymentId), status: current.purchases[purchase.id]!.status };
    if (record.status === "created" && link.status !== "created") record.status = link.status;
    return { before, credited: false, status: record.status };
  });
  if (outcome.credited) await issueBillingInvoice(param(req, "uid"), purchase.id);
  await adminAudit(req, { action: "admin.payment.recheck", target: purchase.id, outcome: outcome.credited ? "credited" : "no_change", before: { status: outcome.before }, after: { status: outcome.status, gateway: link.status, amountPaid: link.amountPaid } });
  invalidateSnapshot();
  return res.json({ gateway: link, ...outcome });
});

router.get("/ledger", allow("credits"), async (req, res) => {
  const snap = await snapshot(req.query["fresh"] === "1");
  const users = userIndex(snap.users);
  const kind = text(req, "kind");
  const uid = text(req, "uid");
  const range = text(req, "from") || text(req, "to") ? rangeOf(req) : null;
  const rows = snap.ledger.filter((entry) => (!kind || entry.kind === kind) && (!uid || entry.uid === uid) && (!range || inRange(entry.at, range)));
  const result = page(req, sortBy(rows, (entry) => entry.at, "desc"));
  res.json({ ...result, items: result.items.map((entry) => ({ ...entry, userEmail: can(req.admin!, "pii") ? users.get(entry.uid)?.email ?? null : maskEmail(users.get(entry.uid)?.email ?? null) })), costs: creditCosts, pricing: { creditPricePaise, packs: creditPacks }, ledgerTrimmed: snap.ledgerTrimmed });
});

router.get("/subscriptions", allow("payments"), async (req, res) => {
  const snap = await snapshot();
  const counts: Record<string, number> = {};
  for (const user of snap.users.filter((item) => item.hasWorkspace)) counts[`${user.planId}:${user.planState}`] = (counts[`${user.planId}:${user.planState}`] ?? 0) + 1;
  res.json({ billingMode, sold: billingMode !== "sandbox" && billingMode !== "off", counts });
});

/* ---------- Reconciliation, audit, health ---------- */

router.get("/reconciliation", allow("reconcile"), async (req, res) => {
  const result = await reconcile();
  await adminAudit(req, { action: "admin.reconcile", outcome: `${result.findings.length} findings` });
  const users = userIndex((await snapshot()).users);
  res.json({ ...result, findings: result.findings.map((finding) => ({ ...finding, userEmail: can(req.admin!, "pii") ? users.get(finding.uid)?.email ?? null : maskEmail(users.get(finding.uid)?.email ?? null) })) });
});

router.get("/audit", allow("audit"), async (req, res) => {
  const range = rangeOf(req);
  const action = text(req, "action");
  const records = (await queryLogs("admin_audit", { ...range, limit: 5000 })).filter((record) => !action || String(record["action"]).startsWith(action));
  res.json({ range, ...page(req, records) });
});

router.get("/health", allow("health"), async (_req, res) => {
  const [lastCall] = await queryLogs("api_calls", { limit: 1 });
  const lastGenerate = (await queryLogs("api_calls", { from: new Date(Date.now() - 30 * 86_400_000).toISOString(), limit: 5000 })).find((call) => call["operation"] === "ewb_generate" && call["outcome"] === "ok") ?? null;
  const [lastWebhook] = await queryLogs("payment_events", { limit: 1 });
  const snap = await snapshot();
  res.json({
    environment: process.env["K_SERVICE"] ? "Cloud Functions" : "local",
    authMode,
    store: process.env["STORE"] === "firestore" ? "firestore" : "file",
    database: "ok",
    ewbProvider: ewbProvider ? { id: ewbProvider.id, label: ewbProvider.label, sandbox: ewbProvider.sandbox } : null,
    ewbProviderSetting,
    gstinapi: { configured: gstinApiConfigured, testMode: gstinApiTestMode },
    razorpay: { configured: razorpayConfigured, webhookSecret: Boolean(process.env["RAZORPAY_WEBHOOK_SECRET"]) },
    distanceLookup: distanceConfigured,
    billingMode,
    creditCosts,
    pricing: { creditPricePaise, packs: creditPacks },
    lastApiCall: lastCall ?? null,
    lastSuccessfulGenerate: lastGenerate,
    lastWebhook: lastWebhook ?? null,
    quota: await providerQuota(),
    snapshotBuiltAt: snap.builtAt,
  });
});

/* ---------- Admins ---------- */

router.get("/admins", allow("admins"), async (_req, res) => {
  const users = await directory().list();
  res.json({
    roles: ADMIN_ROLES.map((role) => ({ role, label: ROLE_LABELS[role], permissions: Object.entries(PERMISSIONS).filter(([, roles]) => (roles as readonly string[]).includes(role)).map(([permission]) => permission) })),
    bootstrap: [...bootstrapEmails],
    admins: users.filter((user) => user.adminRole).map((user) => ({ uid: user.uid, email: user.email, role: user.adminRole, disabled: user.disabled })),
  });
});

router.post("/admins", allow("admins"), recentSignIn(), sensitive, async (req, res) => {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ADMIN_ROLES).nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Enter an email and a role (or none to remove)." });
  const { email, role } = parsed.data;
  if (bootstrapEmails.has(email)) return res.status(409).json({ error: "protected", message: "This email is a super admin through server settings (SUPER_ADMIN_EMAILS)." });
  if (email === req.admin!.email) return res.status(409).json({ error: "self", message: "You cannot change your own role." });
  const user = await directory().getByEmail(email);
  if (!user) return res.status(404).json({ error: "not_found", message: "No account with this email. They must sign up first." });
  if (role && !user.emailVerified) return res.status(409).json({ error: "unverified", message: "That account has not verified its email." });
  await directory().setAdminRole(user.uid, role);
  forgetRole(user.uid);
  await adminAudit(req, { action: "admin.role.set", target: user.uid, outcome: "ok", before: { role: user.adminRole }, after: { role } });
  return res.json({ uid: user.uid, email, role });
});

/* ---------- Exports ---------- */

router.get("/export/:report", allow("export"), async (req, res) => {
  const report = param(req, "report").replace(/\.csv$/, "");
  const snap = await snapshot(true);
  const users = userIndex(snap.users);
  const range = rangeOf(req);
  const email = (uid: string) => users.get(uid)?.email ?? "";
  let rows: Record<string, unknown>[];
  if (report === "users") {
    rows = filterUsers(req, snap.users).map((user) => ({ uid: user.uid, name: user.name, email: user.email, verified: user.emailVerified, status: user.suspended || user.disabled ? "suspended" : "active", registered: user.createdAt, lastSignIn: user.lastSignInAt, business: user.businessName, gstin: user.gstin, ewbs: user.ewbTotal, balance: user.balance, purchasedCredits: user.purchasedCredits, consumedCredits: user.consumedCredits, paidPayments: user.paidPayments, paidRupees: (user.paidPaise / 100).toFixed(2) }));
  } else if (report === "ewbs") {
    rows = snap.ewbs.filter((ewb) => inRange(ewb.generatedAt, range)).map((ewb) => ({ ewbNumber: ewb.ewbNumber, generatedAt: ewb.generatedAt, status: ewb.status, provider: ewb.provider, invoiceNumber: ewb.invoiceNumber, invoiceDate: ewb.invoiceDate, totalRupees: (ewb.totalPaise / 100).toFixed(2), creditsCharged: ewb.creditsCharged, userEmail: email(ewb.uid), sellerGstin: ewb.sellerGstin, buyerName: ewb.buyerName }));
  } else if (report === "payments") {
    rows = snap.purchases.filter((purchase) => inRange(purchase.paidAt ?? purchase.createdAt, range)).map((purchase) => ({ id: purchase.id, provider: purchase.provider, status: purchase.status, credits: purchase.credits, amountRupees: (purchase.amountPaise / 100).toFixed(2), createdAt: purchase.createdAt, paidAt: purchase.paidAt ?? "", paymentId: purchase.paymentId ?? "", userEmail: email(purchase.uid) }));
  } else if (report === "ledger") {
    rows = snap.ledger.filter((entry) => inRange(entry.at, range)).map((entry) => ({ id: entry.id, at: entry.at, kind: entry.kind, status: entry.status, credits: entry.credits, ewbNumber: entry.ewbNumber ?? "", target: entry.targetId ?? "", note: entry.note ?? "", actor: entry.actor ?? "", userEmail: email(entry.uid) }));
  } else if (report === "api-calls") {
    rows = (await apiCalls(range)).records.map((call) => ({ at: call.at, provider: call["provider"], operation: call["operation"], outcome: call["outcome"], httpStatus: call["httpStatus"], errorCode: call["errorCode"] ?? "", durationMs: call["durationMs"], attempt: call["attempt"], testMode: call["testMode"] ?? false, userEmail: email(String(call["workspaceId"] ?? "")), invoiceId: call["invoiceId"] ?? "", ewbNumber: call["ewbNumber"] ?? "" }));
  } else if (report === "audit") {
    if (!can(req.admin!, "audit")) return res.status(403).json({ error: "forbidden", message: "Your admin role cannot do this." });
    rows = (await queryLogs("admin_audit", { ...range, limit: 50_000 })).map((event) => ({ at: event.at, admin: event["adminEmail"], role: event["role"], action: event["action"], target: event["target"], outcome: event["outcome"], reason: event["reason"] ?? "", correlationId: event["correlationId"] }));
  } else {
    return res.status(404).json({ error: "not_found", message: "Unknown report." });
  }
  await adminAudit(req, { action: "admin.export", target: report, outcome: `${rows.length} rows`, after: { from: range.from, to: range.to } });
  return csv(res, report, rows);
});

router.use((_req, res) => res.status(404).json({ error: "not_found", message: "Unknown admin route." }));

export default router;
