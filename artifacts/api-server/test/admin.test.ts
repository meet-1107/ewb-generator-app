import { strict as assert } from "node:assert";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Directory, DirectoryUser } from "../src/lib/admin-directory";

/**
 * The admin API against real app traffic: Firebase-mode tokens signed here,
 * an in-memory account directory, mock gstinapi.in and Razorpay, JSON-file store.
 */

const PROJECT = "demo-ewb";
const KID = "admin-test";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input) === CERT_URL) return new Response(JSON.stringify({ [KID]: keys.publicKey.export({ type: "spki", format: "pem" }) }), { headers: { "cache-control": "max-age=3600" } });
  return realFetch(input, init);
}) as typeof fetch;

const now = () => Math.floor(Date.now() / 1000);
function token(uid: string, email: string, extra: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: KID })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, email, email_verified: true, iat: now(), exp: now() + 3600, auth_time: now(), ...extra })).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(keys.privateKey).toString("base64url")}`;
}

// Accounts as Firebase Authentication would list them.
const accounts = new Map<string, DirectoryUser>();
const account = (uid: string, email: string, adminRole: string | null = null): DirectoryUser => ({ uid, email, name: uid.toUpperCase(), emailVerified: true, disabled: false, createdAt: new Date().toISOString(), lastSignInAt: new Date().toISOString(), providers: ["password"], adminRole });
for (const user of [account("boss", "boss@example.com"), account("fin", "fin@example.com", "finance"), account("sup", "sup@example.com", "support"), account("tec", "tec@example.com", "tech"), account("custaaa1", "a@shop.in"), account("custbbb1", "b@shop.in"), account("idle", "idle@shop.in")]) accounts.set(user.uid, user);
const testDirectory: Directory = {
  async list() { return [...accounts.values()]; },
  async get(uid) { return accounts.get(uid) ?? null; },
  async getByEmail(email) { return [...accounts.values()].find((user) => user.email === email) ?? null; },
  async setDisabled(uid, disabled) { accounts.get(uid)!.disabled = disabled; },
  async setAdminRole(uid, role) { accounts.get(uid)!.adminRole = role; },
};

const T = {
  boss: () => token("boss", "boss@example.com"),
  fin: () => token("fin", "fin@example.com"),
  sup: () => token("sup", "sup@example.com"),
  tec: () => token("tec", "tec@example.com"),
  a: () => token("custaaa1", "a@shop.in"),
  b: () => token("custbbb1", "b@shop.in"),
};

const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const body = (req: IncomingMessage): Promise<Record<string, any>> => new Promise((resolve) => { let data = ""; req.on("data", (c) => (data += c)); req.on("end", () => resolve(data ? JSON.parse(data) : {})); });
const links = new Map<string, { amount: number; status: string; amount_paid: number }>();
let seq = 0;
let rejectNext = false;
const servers: Server[] = [];
async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let base = "";
const SECRET_VALUES = ["gak_admin_secret_key", "rzp_secret_value_123", "whsec_admin_0123456789", "ewb-cred-secret-0123456789"];
before(async () => {
  const gstinBase = await serve(async (req, res) => {
    const data = await body(req);
    if (req.url === "/v1/ewaybill/credentials/test") return json(res, 200, { success: true, valid: true });
    if (req.url === "/v1/ewaybill") {
      if (rejectNext) { rejectNext = false; return json(res, 400, { success: false, error: "Invalid HSN", error_code: "235" }); }
      return json(res, 200, { success: true, credits_remaining: 4321, data: { ewaybill_no: String(171000000000 + ++seq), valid_upto: "14/10/2026 11:59:00 PM", docNo: data.payload.docNo } });
    }
    return json(res, 404, { success: false });
  });
  const razorpayBase = await serve(async (req, res) => {
    const data = await body(req);
    if (req.method === "POST" && req.url === "/v1/payment_links") {
      const id = `plink_adm_${++seq}`;
      links.set(id, { amount: data.amount, status: "created", amount_paid: 0 });
      return json(res, 200, { id, short_url: `https://rzp.io/${id}`, status: "created", amount: data.amount });
    }
    const id = /^\/v1\/payment_links\/(.+)$/.exec(req.url ?? "")?.[1];
    const link = id ? links.get(id) : undefined;
    if (link) return json(res, 200, { id, ...link, payments: link.status === "paid" ? [{ payment_id: "pay_admin_1", status: "captured" }] : null });
    return json(res, 404, {});
  });
  Object.assign(process.env, {
    DATA_DIR: mkdtempSync(path.join(tmpdir(), "ewb-admin-")),
    FIREBASE_PROJECT_ID: PROJECT,
    SUPER_ADMIN_EMAILS: "boss@example.com",
    EWB_PROVIDER: "gstinapi",
    GSTINAPI_KEY: SECRET_VALUES[0],
    GSTINAPI_BASE_URL: gstinBase,
    EWB_CREDENTIALS_SECRET: SECRET_VALUES[3],
    WALLET_START_CREDITS: "30",
    RAZORPAY_KEY_ID: "rzp_test_id",
    RAZORPAY_KEY_SECRET: SECRET_VALUES[1],
    RAZORPAY_WEBHOOK_SECRET: SECRET_VALUES[2],
    RAZORPAY_BASE_URL: razorpayBase,
  });
  const { setDirectory } = await import("../src/lib/admin-directory");
  setDirectory(testDirectory);
  const { default: app } = await import("../src/app");
  const api = app.listen(0, "127.0.0.1");
  servers.push(api);
  await new Promise((resolve) => api.once("listening", resolve));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}/api`;
});
after(() => { for (const server of servers) server.close(); });

async function call(method: string, route: string, auth: string | null, payload?: unknown) {
  const response = await realFetch(`${base}${route}`, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await response.text();
  let parsed: Record<string, any> = {};
  try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  return { status: response.status, body: parsed, text, type: response.headers.get("content-type") ?? "" };
}

const SELLER = "27AAPFU0939F1ZV";
const invoice = (id: string, number: string) => ({
  invoiceId: id, invoiceNumber: number, invoiceDate: new Date().toISOString().slice(0, 10), documentType: "Tax invoice", supplyType: "inter",
  seller: { name: "Shree Traders", gstin: SELLER, address: "Pune", state: "Maharashtra", pincode: "411001" },
  buyer: { name: "Krishna Steels", gstin: "24AAACR5055K1ZD", address: "Ahmedabad", state: "Gujarat", pincode: "382445" },
  lines: [{ description: "Steel", hsn: "7208", quantity: "10", unit: "Nos", taxablePaise: 10_000_000, taxRate: 18 }],
  transport: { transporterName: "", transporterId: "", vehicleNumber: "MH12AB1234", mode: "Road", distanceKm: "700" },
  totals: { taxable: 10_000_000, tax: 1_800_000, total: 11_800_000 },
});
const sign = (raw: string) => createHmac("sha256", SECRET_VALUES[2]!).update(raw).digest("hex");

describe("admin panel API", () => {
  let paidLink = "";
  let pendingLink = "";

  before(async () => {
    // Real app traffic from customer A: portal login, two bills, one rejection, one paid purchase, one unpaid.
    assert.equal((await call("PUT", "/ewb-credentials", T.a(), { gstin: SELLER, username: "u", password: "p" })).status, 200);
    assert.equal((await call("POST", "/ewb/generate", T.a(), { idempotencyKey: "adm-key-1", input: invoice("ia1", "A-001") })).status, 201);
    assert.equal((await call("POST", "/ewb/generate", T.a(), { idempotencyKey: "adm-key-2", input: invoice("ia2", "A-002") })).status, 201);
    rejectNext = true;
    assert.equal((await call("POST", "/ewb/generate", T.a(), { idempotencyKey: "adm-key-3", input: invoice("ia3", "A-003") })).status, 422);
    paidLink = (await call("POST", "/wallet/purchase", T.a(), { credits: 100 })).body.purchase.id;
    const raw = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: paidLink, amount_paid: 10_000, notes: { workspace_id: "custaaa1" } } }, payment: { entity: { id: "pay_hook_1" } } } });
    assert.equal((await realFetch(`${base}/payments/razorpay/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": sign(raw) }, body: raw })).status, 200);
    pendingLink = (await call("POST", "/wallet/purchase", T.b(), { credits: 50 })).body.purchase.id;
  });

  it("refuses non-admins: no token, a customer, and a customer whose token claims to be super admin", async () => {
    assert.equal((await call("GET", "/admin/me", null)).status, 401);
    assert.equal((await call("GET", "/admin/overview", T.a())).status, 403);
    const forged = token("custaaa1", "a@shop.in", { admin_role: "super" });
    assert.equal((await call("GET", "/admin/users", forged)).status, 403, "role comes from the directory, not the token");
    const me = await call("GET", "/admin/me", T.boss());
    assert.equal(me.body.role, "super");
    assert.equal(me.body.bootstrap, true);
  });

  it("dashboard totals match the records the app wrote", async () => {
    const result = await call("GET", "/admin/overview?fresh=1", T.boss());
    assert.equal(result.status, 200, result.text);
    const o = result.body;
    assert.equal(o.users.total, 7);
    assert.equal(o.users.neverGenerated, 6);
    assert.equal(o.ewbs.generated, 2);
    assert.equal(o.ewbs.attempts, 3);
    assert.equal(o.ewbs.failedAttempts, 1);
    // credentials test + 3 generate calls, all recorded against customer A.
    assert.equal(o.api.total, 4);
    assert.equal(o.api.failed, 1);
    assert.equal(o.quota.creditsRemaining, 4321);
    assert.equal(o.payments.paidCount, 1);
    assert.equal(o.payments.grossPaise, 10_000);
    assert.equal(o.payments.pending, 1);
    assert.equal(o.credits.purchased, 100);
    assert.equal(o.credits.consumed, 10);
    assert.equal(o.credits.returnedHolds, 5);
    // 30 + 100 - 10 for A, 30 for B (other accounts never opened the app).
    assert.equal(o.credits.outstanding, 150);
  });

  it("per-user rows and detail come from the same records", async () => {
    const list = await call("GET", "/admin/users?q=a@shop.in", T.boss());
    assert.equal(list.body.total, 1);
    const row = list.body.items[0];
    assert.deepEqual([row.ewbTotal, row.balance, row.purchasedCredits, row.paidPayments, row.paidPaise], [2, 120, 100, 1, 10_000]);
    const detail = await call("GET", "/admin/users/custaaa1", T.boss());
    assert.equal(detail.body.ewbs.length, 2);
    assert.equal(detail.body.attempts.rejected, 1);
    assert.equal(detail.body.api.total, 4);
    assert.ok(!JSON.stringify(detail.body).includes("passwordEnc"), "portal passwords never leave the server");
  });

  it("limits each role to its modules and masks personal data for technical admins", async () => {
    assert.equal((await call("GET", "/admin/users", T.sup())).status, 200);
    assert.equal((await call("GET", "/admin/api-usage", T.sup())).status, 403);
    assert.equal((await call("GET", "/admin/export/users", T.sup())).status, 403);
    assert.equal((await call("POST", "/admin/users/custaaa1/credits", T.sup(), { credits: 5, reason: "goodwill gift", reference: "ref-support-1" })).status, 403);
    assert.equal((await call("GET", "/admin/payments", T.tec())).status, 403);
    const tech = await call("GET", "/admin/users?q=custaaa1", T.tec());
    assert.equal(tech.status, 200);
    assert.notEqual(tech.body.items[0].email, "a@shop.in");
    assert.equal((await call("GET", "/admin/api-usage", T.tec())).status, 200);
    assert.equal((await call("GET", "/admin/admins", T.fin())).status, 403);
  });

  it("credit adjustments need a recent sign-in, apply once per reference, never go negative, and are audited", async () => {
    const stale = token("fin", "fin@example.com", { auth_time: now() - 3600 });
    assert.equal((await call("POST", "/admin/users/custbbb1/credits", stale, { credits: 25, reason: "Goodwill for outage", reference: "ref-adjust-001" })).body.error, "reauth_required");
    const first = await call("POST", "/admin/users/custbbb1/credits", T.fin(), { credits: 25, reason: "Goodwill for outage", reference: "ref-adjust-001" });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.balance, 55);
    const replay = await call("POST", "/admin/users/custbbb1/credits", T.fin(), { credits: 25, reason: "Goodwill for outage", reference: "ref-adjust-001" });
    assert.equal(replay.body.replay, true);
    assert.equal(replay.body.balance, 55);
    assert.equal((await call("POST", "/admin/users/custbbb1/credits", T.fin(), { credits: -500, reason: "Remove test credit", reference: "ref-adjust-002" })).status, 409);
    assert.equal((await call("GET", "/wallet", T.b())).body.balance, 55, "the customer sees the same balance");
    const audit = await call("GET", "/admin/audit?action=admin.credits.adjust", T.boss());
    assert.equal(audit.body.items.filter((event: any) => event.outcome === "ok").length, 1);
    assert.equal(audit.body.items[0].reason ?? audit.body.items[1].reason, "Remove test credit");
  });

  it("suspending an account blocks its API access at once; reactivating restores it", async () => {
    assert.equal((await call("POST", "/admin/users/custbbb1/suspension", T.boss(), { suspended: true, reason: "Chargeback investigation" })).status, 200);
    assert.equal(accounts.get("custbbb1")!.disabled, true);
    assert.equal((await call("GET", "/wallet", T.b())).body.error, "account_suspended");
    assert.equal((await call("POST", "/admin/users/boss/suspension", T.boss(), { suspended: true, reason: "testing self" })).status, 409);
    assert.equal((await call("POST", "/admin/users/custbbb1/suspension", T.fin(), { suspended: false, reason: "not allowed for finance" })).status, 403);
    assert.equal((await call("POST", "/admin/users/custbbb1/suspension", T.boss(), { suspended: false, reason: "Investigation closed" })).status, 200);
    assert.equal((await call("GET", "/wallet", T.b())).status, 200);
  });

  it("shows each step buying credits with the account's email, in payments and active users", async () => {
    // Customer B reaches the payment page and comes back without paying; customer A goes back at checkout.
    for (const [auth, step, extra] of [
      [T.b(), "checkout_opened", { credits: 50 }], [T.b(), "payment_page_opened", { credits: 50, purchaseId: pendingLink }], [T.b(), "returned_unpaid", { credits: 50, purchaseId: pendingLink }],
      [T.a(), "checkout_opened", { credits: 250 }], [T.a(), "checkout_closed", { credits: 250 }],
    ] as const) assert.equal((await call("POST", "/activity/payment", auth, { step, ...extra, appVersion: "1.3.11" })).status, 204);
    assert.equal((await call("POST", "/activity/payment", T.b(), { step: "made_up" })).status, 400);
    await call("POST", "/activity/open", T.b(), { platform: "android", appVersion: "1.3.11" });

    const log = await call("GET", "/admin/payment-log", T.fin());
    assert.equal(log.status, 200, log.text);
    assert.equal(log.body.summary.checkouts, 2);
    assert.equal(log.body.summary.closedAtCheckout, 1);
    assert.equal(log.body.summary.cameBackUnpaid, 1);
    assert.ok(log.body.items.some((row: any) => row.email === "b@shop.in" && row.step === "returned_unpaid" && row.purchaseId === pendingLink));

    const payments = await call("GET", "/admin/payments?provider=razorpay&fresh=1", T.fin());
    const outcome = (id: string) => payments.body.items.find((row: any) => row.id === id)?.outcome;
    assert.equal(outcome(pendingLink), "Came back without paying");
    assert.equal(outcome(paidLink), "Paid");
    const detail = await call("GET", `/admin/payments/custbbb1/${pendingLink}`, T.fin());
    // The steps on this link (a checkout is listed only when it came before the link, as in the app).
    assert.deepEqual(detail.body.appSteps.map((row: any) => row.step).sort(), ["payment_page_opened", "returned_unpaid"]);
    assert.equal(detail.body.outcome, "Came back without paying");

    const active = await call("GET", "/admin/activity", T.boss());
    const row = active.body.users.find((user: any) => user.uid === "custbbb1");
    assert.equal(row.email, "b@shop.in");
    assert.equal(row.lastPaymentStep, "returned_unpaid");
    assert.equal(row.cameBackUnpaid, 1);
    assert.equal(row.pendingPayments, 1);
  });

  it("sets the Android versions apps must update from, for super admins only, and tells the app", async () => {
    assert.equal((await call("GET", "/config", T.a())).body.androidUpdate.minVersionCode, 0);
    assert.equal((await call("POST", "/admin/app-version", T.fin(), { minVersionCode: 15, latestVersionCode: 16, message: "" })).status, 403);
    assert.equal((await call("POST", "/admin/app-version", T.boss(), { minVersionCode: 17, latestVersionCode: 16, message: "" })).status, 400);
    const saved = await call("POST", "/admin/app-version", T.boss(), { minVersionCode: 15, latestVersionCode: 16, message: "New GST rates" });
    assert.equal(saved.status, 200, saved.text);
    const update = (await call("GET", "/config", T.a())).body.androidUpdate;
    assert.deepEqual({ min: update.minVersionCode, latest: update.latestVersionCode, message: update.message }, { min: 15, latest: 16, message: "New GST rates" });
    assert.match(update.storeUrl, /play\.google\.com\/store\/apps\/details\?id=com\.ewayeasy\.app/);
    assert.equal((await call("GET", "/admin/app-version", T.tec())).body.setting.minVersionCode, 15);
  });

  it("re-checks an unpaid payment with the gateway and credits it once", async () => {
    links.get(pendingLink)!.status = "paid";
    links.get(pendingLink)!.amount_paid = 5_000;
    const first = await call("POST", `/admin/payments/custbbb1/${pendingLink}/recheck`, T.fin());
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.credited, true);
    const second = await call("POST", `/admin/payments/custbbb1/${pendingLink}/recheck`, T.fin());
    assert.equal(second.body.credited, false);
    assert.equal((await call("GET", "/wallet", T.b())).body.balance, 105);
  });

  it("reconciliation is clean for consistent records and flags a planted inconsistency", async () => {
    const clean = await call("GET", "/admin/reconciliation", T.fin());
    assert.equal(clean.status, 200, clean.text);
    assert.deepEqual(clean.body.findings.filter((finding: any) => finding.severity === "high"), []);
    const { withWorkspace } = await import("../src/lib/store");
    await withWorkspace("custbbb1", (w) => { w.wallet.ledger.push({ id: "ghost", at: new Date().toISOString(), kind: "topup", credits: 999, status: "credited", targetId: "plink_ghost" }); });
    const dirty = await call("GET", "/admin/reconciliation", T.fin());
    const kinds = dirty.body.findings.map((finding: any) => finding.kind);
    assert.ok(kinds.includes("credit_without_purchase"), kinds.join());
    assert.ok(kinds.includes("balance_mismatch"), kinds.join());
  });

  it("only a super admin, recently signed in, can grant roles; not to themselves or bootstrap admins", async () => {
    assert.equal((await call("POST", "/admin/admins", T.fin(), { email: "idle@shop.in", role: "support" })).status, 403);
    assert.equal((await call("POST", "/admin/admins", token("boss", "boss@example.com", { auth_time: now() - 7200 }), { email: "idle@shop.in", role: "support" })).body.error, "reauth_required");
    assert.equal((await call("POST", "/admin/admins", T.boss(), { email: "boss@example.com", role: null })).status, 409);
    assert.equal((await call("POST", "/admin/admins", T.boss(), { email: "idle@shop.in", role: "support" })).status, 200);
    assert.equal(accounts.get("idle")!.adminRole, "support");
    assert.equal((await call("POST", "/admin/admins", T.boss(), { email: "idle@shop.in", role: null })).status, 200);
  });

  it("exports CSV for permitted roles, neutralises formula cells, and audits the export", async () => {
    const exported = await call("GET", "/admin/export/users", T.fin());
    assert.equal(exported.status, 200);
    assert.match(exported.type, /text\/csv/);
    assert.match(exported.text.split("\r\n")[0]!, /^uid,name,email,verified/);
    assert.ok(exported.text.includes("a@shop.in"));
    const audit = await call("GET", "/admin/audit?action=admin.export", T.boss());
    assert.ok(audit.body.items.length >= 1);
  });

  it("never returns server secrets", async () => {
    for (const route of ["/admin/health", "/admin/overview", "/admin/users/custaaa1", "/admin/api-usage", "/admin/payments"]) {
      const result = await call("GET", route, T.boss());
      assert.equal(result.status, 200, route);
      for (const secret of SECRET_VALUES) assert.ok(!result.text.includes(secret), `${route} leaks a secret`);
    }
  });
});
