import { strict as assert } from "node:assert";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * The API as deployed: FIREBASE_PROJECT_ID set, so every call needs a
 * Firebase ID token. Google's signing certificates are replaced by a local
 * key pair; tokens are signed here.
 */

const PROJECT = "demo-ewb";
const signing = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-kid";
const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input) === CERT_URL) {
    return new Response(JSON.stringify({ [KID]: signing.publicKey.export({ type: "spki", format: "pem" }) }), { headers: { "cache-control": "max-age=3600" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

function token(claims: Record<string, unknown>, key = signing.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: KID })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: now, exp: now + 3600, email_verified: true, firebase: { sign_in_provider: "password" }, ...claims })).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key).toString("base64url")}`;
}

let server: Server;
let base = "";
before(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-auth-"));
  process.env["FIREBASE_PROJECT_ID"] = PROJECT;
  delete process.env["BILLING_PROVIDER"];
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

const call = async (method: string, route: string, auth: string | null, body?: unknown, headers: Record<string, string> = {}) => {
  const response = await realFetch(`${base}${route}`, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

describe("API authentication (Firebase mode)", () => {
  it("refuses calls without a token, with a forged signature, expired, for another project, or with an unverified email", async () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal((await call("GET", "/wallet", null)).status, 401);
    assert.equal((await call("GET", "/wallet", token({ sub: "userA" }, attacker.privateKey))).status, 401);
    assert.equal((await call("GET", "/wallet", token({ sub: "userA", iat: now - 7200, exp: now - 3600 }))).status, 401);
    assert.equal((await call("GET", "/wallet", token({ sub: "userA", aud: "someone-else" }))).status, 401);
    assert.equal((await call("GET", "/wallet", token({ sub: "userA", email_verified: false }))).status, 403);
    assert.equal((await call("GET", "/wallet", token({ sub: "userA" }))).status, 200);
  });

  it("ignores x-workspace-id: a user only ever sees their own records", async () => {
    const a = token({ sub: "userAAA" });
    const b = token({ sub: "userBBB" });
    const pushed = await call("POST", "/sync", a, { collections: { invoices: [{ id: "i1", updatedAt: "2026-10-01T00:00:00.000Z", data: { buyerName: "Secret buyer" } }] } });
    assert.equal(pushed.status, 200);
    const seen = await call("POST", "/sync", b, { collections: {} }, { "x-workspace-id": "userAAA" });
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.body["changes"]["invoices"] ?? [], []);
  });

  it("does not let a signed-in user switch to a paid plan without paying", async () => {
    const result = await call("POST", "/subscription/change", token({ sub: "userCCC" }), { planId: "business" });
    assert.equal(result.status, 501);
    const subscription = await call("GET", "/subscription", token({ sub: "userCCC" }));
    assert.notEqual(subscription.body["subscription"].planId, "business");
  });

  it("refuses wallet top-ups without the admin token", async () => {
    const result = await call("POST", "/admin/wallet/topup", token({ sub: "userA" }), { workspaceId: "userAAA", credits: 1000 }, { "x-admin-token": "guess" });
    assert.equal(result.status, 401);
  });
});
