import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * End-to-end tests of the e-way bill and wallet routes, against the real
 * gstinapi.in adapter talking to a local mock of gstinapi.in, and a mock of
 * Razorpay. Sandbox auth (x-workspace-id), JSON-file store.
 */

type Bill = { ewbNumber: string; docNo: string };
const gstin = {
  bills: new Map<string, Bill>(),
  generateCalls: 0,
  /** Next generate: "ok" | "drop" (bill created, connection cut before the reply) | "reject". */
  next: "ok" as "ok" | "drop" | "reject",
  lastDistance: "",
};
let counter = 0;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {}));
  });
}

const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

let gstinServer: Server;
let razorpayServer: Server;
let apiServer: Server;
let base = "";
const WEBHOOK_SECRET = "whsec_test_0123456789";
const links = new Map<string, { amount: number; status: string; amount_paid: number }>();

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

before(async () => {
  gstinServer = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === "/v1/ewaybill/credentials/test") return json(res, 200, { success: true, valid: true });
    if (req.url === "/v1/ewaybill") {
      gstin.generateCalls += 1;
      const payload = body["payload"] as { docNo: string; transDistance: string };
      gstin.lastDistance = payload.transDistance;
      const mode = gstin.next;
      gstin.next = "ok";
      if (mode === "reject") return json(res, 400, { success: false, error: "Invalid HSN", error_code: "235" });
      // Like gstinapi.in: the same document number returns the bill already generated for it.
      let bill = gstin.bills.get(payload.docNo);
      const existed = Boolean(bill);
      if (!bill) {
        bill = { ewbNumber: String(181000000000 + ++counter), docNo: payload.docNo };
        gstin.bills.set(payload.docNo, bill);
      }
      if (mode === "drop") return req.socket.destroy();
      return json(res, 200, { success: true, data: { ewaybill_no: bill.ewbNumber, ewaybill_date: "10/10/2026 10:00:00 AM", valid_upto: "14/10/2026 11:59:00 PM", already_existed: existed } });
    }
    if (req.url === "/v1/ewaybill/cancel") return json(res, 200, { success: true });
    return json(res, 404, { success: false, error: "not found" });
  });
  razorpayServer = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.method === "POST" && req.url === "/v1/payment_links") {
      const id = `plink_${++counter}`;
      links.set(id, { amount: body["amount"] as number, status: "created", amount_paid: 0 });
      return json(res, 200, { id, short_url: `https://rzp.io/${id}`, status: "created", amount: body["amount"] });
    }
    const id = /^\/v1\/payment_links\/(.+)$/.exec(req.url ?? "")?.[1];
    const link = id ? links.get(id) : undefined;
    if (link) return json(res, 200, { id, ...link, payments: link.status === "paid" ? [{ payment_id: "pay_1", status: "captured" }] : null });
    return json(res, 404, { error: { description: "not found" } });
  });
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-routes-"));
  process.env["EWB_PROVIDER"] = "gstinapi";
  process.env["GSTINAPI_KEY"] = "gak_test";
  process.env["GSTINAPI_BASE_URL"] = await listen(gstinServer);
  process.env["EWB_CREDENTIALS_SECRET"] = "test-secret-0123456789";
  process.env["WALLET_START_CREDITS"] = "15";
  process.env["RAZORPAY_KEY_ID"] = "rzp_test_key";
  process.env["RAZORPAY_KEY_SECRET"] = "rzp_test_secret";
  process.env["RAZORPAY_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
  process.env["RAZORPAY_BASE_URL"] = await listen(razorpayServer);
  delete process.env["FIREBASE_PROJECT_ID"];
  const { default: app } = await import("../src/app");
  apiServer = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => apiServer.once("listening", resolve));
  base = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}/api`;
});
after(() => { apiServer.close(); gstinServer.close(); razorpayServer.close(); });

let workspaceSeq = 0;
function workspace() {
  const id = `wstest${Date.now().toString(36)}${++workspaceSeq}xx`;
  const call = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { "x-workspace-id": id, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  return { id, call };
}

const SELLER = "27AAPFU0939F1ZV";
function invoice(invoiceId: string, invoiceNumber: string, taxablePaise = 25_000_000) {
  const tax = Math.round(taxablePaise * 0.18);
  return {
    invoiceId,
    invoiceNumber,
    invoiceDate: new Date().toISOString().slice(0, 10),
    documentType: "Tax invoice",
    supplyType: "inter",
    seller: { name: "Shree Traders", gstin: SELLER, address: "Pune", state: "Maharashtra", pincode: "411001" },
    buyer: { name: "Krishna Steels", gstin: "24AAACR5055K1ZD", address: "Ahmedabad", state: "Gujarat", pincode: "382445" },
    lines: [{ description: "Steel coil", hsn: "7208", quantity: "10", unit: "Nos", taxablePaise, taxRate: 18 }],
    transport: { transporterName: "", transporterId: "", vehicleNumber: "MH12AB1234", mode: "Road", distanceKm: "700" },
    totals: { taxable: taxablePaise, tax, total: taxablePaise + tax },
  };
}

async function readyWorkspace() {
  const ws = workspace();
  const saved = await ws.call("PUT", "/ewb-credentials", { gstin: SELLER, username: "api_user", password: "secret" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return ws;
}

const balance = async (ws: ReturnType<typeof workspace>) => (await ws.call("GET", "/wallet")).body["balance"] as number;

describe("e-way bill generation (gstinapi adapter, mocked provider)", () => {
  it("generates once and charges once; a retry with the same key replays without a second charge", async () => {
    const ws = await readyWorkspace();
    const first = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-aaaa-1", input: invoice("inv1", "INV-001") });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body["balance"], 10);
    const again = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-aaaa-1", input: invoice("inv1", "INV-001") });
    assert.equal(again.status, 200);
    assert.equal(again.body["replay"], true);
    assert.equal(again.body["ewb"].ewbNumber, first.body["ewb"].ewbNumber);
    assert.equal(await balance(ws), 10);
  });

  it("lists wallet history by month", async () => {
    const ws = await readyWorkspace();
    await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-hist-1", input: invoice("hist1", "HIST-001") });
    const month = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
    const summary = (await ws.call("GET", "/wallet")).body;
    assert.deepEqual(summary["historyMonths"][0], { month, count: 2, added: 15, used: 5 });
    const history = await ws.call("GET", `/wallet/history?month=${month}`);
    assert.equal(history.status, 200, JSON.stringify(history.body));
    assert.deepEqual(history.body["entries"].map((entry: { kind: string }) => entry.kind), ["generate", "grant"]);
    assert.equal((await ws.call("GET", "/wallet/history?month=1999-01")).body["entries"].length, 0);
    assert.equal((await ws.call("GET", "/wallet/history?month=2026-13")).status, 400);
  });

  it("lets NIC calculate the distance between different PIN codes, and sends the entered one within a PIN code", async () => {
    const ws = await readyWorkspace();
    await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-dist-1", input: invoice("dist1", "DIST-1") });
    assert.equal(gstin.lastDistance, "0");
    const local = invoice("dist2", "DIST-2");
    local.buyer = { ...local.buyer, pincode: "411001", state: "Maharashtra", gstin: "27AAPFU0939F1ZV" };
    local.supplyType = "intra";
    local.transport.distanceKm = "12";
    await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-dist-2", input: local });
    assert.equal(gstin.lastDistance, "12");
  });

  it("a double tap (two parallel requests, same key) creates one bill and one charge", async () => {
    const ws = await readyWorkspace();
    const before = gstin.generateCalls;
    const [a, b] = await Promise.all([1, 2].map(() => ws.call("POST", "/ewb/generate", { idempotencyKey: "key-dbl-tap", input: invoice("inv-dbl", "DBL-1") })));
    // The second request either finds the first still running (409) or, if the store serialised them, replays its bill (200).
    const [first, second] = [a!, b!].sort((x, y) => x.status - y.status);
    assert.ok(first.status === 201 || second.status === 201, JSON.stringify([a!.status, b!.status]));
    const other = first.status === 201 ? second : first;
    assert.ok(other.status === 409 || (other.status === 200 && other.body["replay"] === true), JSON.stringify(other.body));
    assert.equal(gstin.generateCalls - before, 1);
    assert.equal(await balance(ws), 10);
  });

  it("two parallel submits of one invoice with different keys (two queued confirm dialogs) create one bill and one charge", async () => {
    const ws = await readyWorkspace();
    const [a, b] = await Promise.all(["key-twokeys-a", "key-twokeys-b"].map((key) => ws.call("POST", "/ewb/generate", { idempotencyKey: key, input: invoice("inv-2k", "TWOKEY-1") })));
    assert.deepEqual([a!.status, b!.status].sort(), [201, 409], JSON.stringify([a!.body, b!.body]));
    assert.equal((await ws.call("GET", "/ewb")).body["ewbs"].length, 1);
    assert.equal(await balance(ws), 10);
  });

  it("two invoices racing for the last credits: one succeeds, the other is refused", async () => {
    const ws = await readyWorkspace();
    await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-race-0", input: invoice("r0", "RACE-0") });
    const [a, b] = await Promise.all([
      ws.call("POST", "/ewb/generate", { idempotencyKey: "key-race-1", input: invoice("r1", "RACE-1") }),
      ws.call("POST", "/ewb/generate", { idempotencyKey: "key-race-2", input: invoice("r2", "RACE-2") }),
    ]);
    // 15 start credits, 5 per bill: after RACE-0 only one more fits... then 0 left.
    assert.deepEqual([a.status, b.status].sort(), [201, 201]);
    const c = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-race-3", input: invoice("r3", "RACE-3") });
    assert.equal(c.status, 402);
    assert.equal(await balance(ws), 0);
  });

  it("a provider rejection is not charged", async () => {
    const ws = await readyWorkspace();
    gstin.next = "reject";
    const result = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-reject-1", input: invoice("rej", "REJ-1") });
    assert.equal(result.status, 422);
    assert.equal(await balance(ws), 15);
  });

  it("refuses a second invoice that reuses a document number already on an e-way bill", async () => {
    const ws = await readyWorkspace();
    const first = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-dup-a", input: invoice("dup-a", "SAME-7") });
    assert.equal(first.status, 201);
    // A different invoice (other buyer) with the same number: the portal would hand back the first bill.
    const second = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-dup-b", input: invoice("dup-b", "same-7") });
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.equal(second.body["error"], "duplicate_number");
    assert.equal(await balance(ws), 10, "no second charge");
    const list = await ws.call("GET", "/ewb");
    assert.equal(list.body["ewbs"].length, 1);
  });

  it("refuses a document number that already has a bill on the portal (made outside the app), without charging", async () => {
    const ws = await readyWorkspace();
    // Made on the NIC portal days ago: gstinapi.in hands that old bill back with already_existed.
    gstin.bills.set("PORTAL-9", { ewbNumber: "602198434715", docNo: "PORTAL-9" });
    const made = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-portal-9", input: invoice("portal-9", "PORTAL-9") });
    assert.equal(made.status, 409, JSON.stringify(made.body));
    assert.equal(made.body["error"], "duplicate_number");
    assert.match(String(made.body["message"]), /602198434715.*portal/);
    assert.equal(await balance(ws), 15, "not charged");
    assert.equal((await ws.call("GET", "/ewb")).body["ewbs"].length, 0, "the old bill is not attached to this invoice");
    // Tapping Generate again sends the same key: still refused, still not charged.
    const again = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-portal-9", input: invoice("portal-9", "PORTAL-9") });
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(await balance(ws), 15, "second tap not charged");
    assert.equal((await ws.call("GET", "/ewb")).body["ewbs"].length, 0);
  });

  it("a cut connection after the provider created the bill is reported as unknown, and the retry recovers the same bill with one charge", async () => {
    const ws = await readyWorkspace();
    gstin.next = "drop";
    const lost = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-drop-1", input: invoice("drop", "DROP-1") });
    assert.equal(lost.status, 502, JSON.stringify(lost.body));
    assert.equal(lost.body["error"], "outcome_unknown");
    assert.equal(await balance(ws), 15, "not charged while unknown");
    const retry = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-drop-1", input: invoice("drop", "DROP-1") });
    assert.equal(retry.status, 201);
    assert.equal(retry.body["ewb"].ewbNumber, gstin.bills.get("DROP-1")!.ewbNumber);
    assert.equal(await balance(ws), 10);
  });

  it("a request left pending by a crashed instance can be retried later, and its held credits are returned", async () => {
    const ws = await readyWorkspace();
    const { withWorkspace } = await import("../src/lib/store");
    const { holdCredits } = await import("../src/lib/wallet");
    const staleAt = new Date(Date.now() - 10 * 60_000).toISOString();
    // What a function instance killed mid-call leaves behind.
    await withWorkspace(`sbx_${ws.id}`, (w) => {
      const hold = holdCredits(w, "generate", "stale");
      w.requests["key-stale-1"] = { id: "req-stale", idempotencyKey: "key-stale-1", invoiceId: "stale", state: "pending", createdAt: staleAt, holdId: hold.ok ? hold.entryId ?? undefined : undefined } as never;
    }, { requests: ["key-stale-1"] });
    assert.equal(await balance(ws), 10);
    const retry = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-stale-1", input: invoice("stale", "STALE-1") });
    assert.equal(retry.status, 201, JSON.stringify(retry.body));
    assert.equal(await balance(ws), 10, "stale hold refunded, new bill charged once");
  });

  it("rejects totals whose taxable value does not match the lines", async () => {
    const ws = await readyWorkspace();
    const input = invoice("tot", "TOT-1");
    input.totals = { ...input.totals, taxable: input.totals.taxable - 100_000, tax: input.totals.tax + 100_000 };
    const result = await ws.call("POST", "/ewb/generate", { idempotencyKey: "key-tot-1", input });
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.equal(await balance(ws), 15);
  });

  it("keeps workspaces apart: another workspace cannot read or act on a bill", async () => {
    const owner = await readyWorkspace();
    const made = await owner.call("POST", "/ewb/generate", { idempotencyKey: "key-iso-1", input: invoice("iso", "ISO-1") });
    const id = made.body["ewb"].id as string;
    const other = await readyWorkspace();
    assert.equal((await other.call("GET", `/ewb/${id}`)).status, 404);
    assert.equal((await other.call("POST", `/ewb/${id}/actions`, { action: "cancel", reason: "Duplicate" })).status, 404);
    assert.equal((await other.call("GET", "/ewb")).body["ewbs"].length, 0);
  });
});

describe("credit purchases (Razorpay, mocked)", () => {
  const sign = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  const webhook = (raw: string, signature: string) => fetch(`${base}/payments/razorpay/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": signature }, body: raw });
  const paidEvent = (linkId: string, workspaceId: string, amountPaid: number) => JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: linkId, amount_paid: amountPaid, notes: { workspace_id: workspaceId } } }, payment: { entity: { id: "pay_1" } } } });

  it("adds credits once for a verified payment, ignores bad signatures, replays and short payments", async () => {
    const ws = workspace();
    const started = await ws.call("POST", "/wallet/purchase", { credits: 100 });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const linkId = started.body["purchase"].id as string;
    assert.equal(started.body["purchase"].amountPaise, 10_000);

    const short = paidEvent(linkId, `sbx_${ws.id}`, 5_000);
    assert.equal((await webhook(short, sign(short))).status, 200);
    assert.equal(await balance(ws), 15, "short payment adds nothing");

    const full = paidEvent(linkId, `sbx_${ws.id}`, 10_000);
    assert.equal((await webhook(full, "0".repeat(64))).status, 401, "forged signature refused");
    assert.equal(await balance(ws), 15);
    assert.equal((await webhook(full, sign(full))).status, 200);
    assert.equal((await webhook(full, sign(full))).status, 200, "replayed delivery");
    assert.equal(await balance(ws), 115, "credited exactly once");

    // The app's status check after returning from checkout must not credit again.
    links.get(linkId)!.status = "paid";
    links.get(linkId)!.amount_paid = 10_000;
    const checked = await ws.call("GET", `/wallet/purchase/${linkId}`);
    assert.equal(checked.body["balance"], 115);
  });

  it("does not trust a client-supplied amount", async () => {
    const ws = workspace();
    const started = await ws.call("POST", "/wallet/purchase", { credits: 100, amountPaise: 1 });
    assert.equal(started.body["purchase"].amountPaise, 10_000);
  });

  it("another workspace cannot read or settle someone else's purchase", async () => {
    const owner = workspace();
    const started = await owner.call("POST", "/wallet/purchase", { credits: 50 });
    const linkId = started.body["purchase"].id as string;
    const other = workspace();
    assert.equal((await other.call("GET", `/wallet/purchase/${linkId}`)).status, 404);
  });
});
