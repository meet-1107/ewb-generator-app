import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * Paid lookups are made as rarely as the rules allow: one GSTIN lookup per
 * GSTIN (shared by all accounts) plus one status refresh per GSTIN per 30
 * days; one distance lookup per PIN pair, in either direction.
 */

const providerStatus = new Map<string, string>();
let lookups = 0;
let providerDown = false;
let routeCalls = 0;
let server: Server;
let gstinServer: Server;
let base = "";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** A GSTIN with a correct check digit. */
function withCheckDigit(first14: string) {
  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const product = CHARS.indexOf(first14[index]!) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return first14 + CHARS[(36 - (sum % 36)) % 36];
}
const KNOWN = "24AAACR5055K1ZD";
const ALSO_KNOWN = "27AAPFU0939F1ZV";
const UNKNOWN = withCheckDigit("29ZZZZZ9999Z1Z");

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).startsWith("https://routes.googleapis.com/")) {
    routeCalls += 1;
    return new Response(JSON.stringify({ routes: [{ distanceMeters: 652_300 }] }), { headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

before(async () => {
  providerStatus.set(KNOWN, "Active");
  providerStatus.set(ALSO_KNOWN, "Active");
  gstinServer = createServer((req, res) => {
    const gstin = /^\/v1\/gstin\/(.+)$/.exec(req.url ?? "")?.[1];
    res.setHeader("content-type", "application/json");
    if (!gstin) { res.writeHead(404); return res.end("{}"); }
    lookups += 1;
    if (providerDown) { res.writeHead(502); return res.end(JSON.stringify({ success: false, error: "upstream down" })); }
    const status = providerStatus.get(gstin);
    if (!status) { res.writeHead(404); return res.end(JSON.stringify({ success: false, error: "GSTIN not found" })); }
    res.end(JSON.stringify({ success: true, gstin, credits_remaining: 900, data: { gstin, legal_name: "RAMESH PATEL", trade_name: "KRISHNA STEELS", status, taxpayer_type: "Regular", registration_date: "2019-04-01", cancellation_date: status === "Cancelled" ? "2026-09-01" : null, state_code: gstin.slice(0, 2), address: "Plot 12, GIDC", pincode: "382445", block_status: null } }));
  });
  await new Promise<void>((resolve) => gstinServer.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    DATA_DIR: mkdtempSync(path.join(tmpdir(), "ewb-cost-")),
    GSTINAPI_KEY: "gak_cost_test",
    GSTINAPI_BASE_URL: `http://127.0.0.1:${(gstinServer.address() as AddressInfo).port}`,
    GOOGLE_MAPS_API_KEY: "maps_test_key",
  });
  delete process.env["FIREBASE_PROJECT_ID"];
  delete process.env["GSTIN_STATUS_TTL_DAYS"];
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => { server.close(); gstinServer.close(); });

let seq = 0;
const account = () => `costtest${Date.now().toString(36)}${++seq}aa`;
async function verify(gstin: string, workspace = account()) {
  const response = await realFetch(`${base}/gstin/verify`, { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": workspace }, body: JSON.stringify({ gstin }) });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe("paid lookups are kept to the minimum", () => {
  it("never calls the provider for a GSTIN that fails the format or check digit", async () => {
    const before = lookups;
    assert.equal((await verify("24AAACR5055K1ZX")).status, 400);
    assert.equal((await verify("24AAACR5055K1Z")).status, 400);
    assert.equal(lookups, before);
  });

  it("looks a GSTIN up once for all accounts, even when several ask at the same moment", async () => {
    const before = lookups;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => verify(KNOWN)));
    assert.ok(results.every((result) => result.status === 200 && result.body["gstin"].tradeName === "KRISHNA STEELS"));
    assert.equal((await verify(KNOWN)).body["cached"], true);
    assert.equal(lookups - before, 1);
  });

  it("remembers an unregistered GSTIN for a day instead of asking again", async () => {
    const before = lookups;
    assert.equal((await verify(UNKNOWN)).status, 404);
    assert.equal((await verify(UNKNOWN)).status, 404);
    assert.equal(lookups - before, 1);
  });

  it("re-checks the status once it is older than 30 days, keeping the saved details", async () => {
    await verify(ALSO_KNOWN);
    const { withDoc } = await import("../src/lib/store");
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    // A record saved 40 days ago, with an address the provider no longer returns.
    await withDoc<Record<string, unknown>, null>("gstins", ALSO_KNOWN, (current) => ({ next: { ...current, statusCheckedAt: old, verifiedAt: old }, result: null }));
    providerStatus.set(ALSO_KNOWN, "Cancelled");
    const before = lookups;
    const refreshed = await verify(ALSO_KNOWN);
    assert.equal(lookups - before, 1);
    assert.equal(refreshed.body["gstin"].status, "Cancelled");
    assert.equal(refreshed.body["gstin"].verifiedAt, old, "registration details keep their first-fetch date");
    assert.equal((await verify(ALSO_KNOWN)).body["cached"], true);
    assert.equal(lookups - before, 1, "no second refresh within 30 days");
  });

  it("serves the saved details, marked stale, when the status refresh fails", async () => {
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const { withDoc } = await import("../src/lib/store");
    await withDoc<Record<string, unknown>, null>("gstins", KNOWN, (current) => ({ next: { ...current, statusCheckedAt: old }, result: null }));
    providerDown = true;
    const result = await verify(KNOWN);
    providerDown = false;
    assert.equal(result.status, 200);
    assert.equal(result.body["stale"], true);
    assert.equal(result.body["gstin"].legalName, "RAMESH PATEL");
  });

  it("looks a PIN-to-PIN distance up once, and reuses it for the return trip", async () => {
    const call = (from: string, to: string) => realFetch(`${base}/distance?from=${from}&to=${to}`, { headers: { "x-workspace-id": account() } }).then((response) => response.json() as Promise<Record<string, any>>);
    const before = routeCalls;
    const [a, b] = await Promise.all([call("411001", "382445"), call("411001", "382445")]);
    assert.equal(a["km"], 653);
    assert.equal(b["km"], 653);
    assert.equal((await call("382445", "411001"))["cached"], true);
    assert.equal(routeCalls - before, 1);
  });
});
