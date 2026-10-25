import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * GSTIN verification: a GSTIN already looked up (by any account) is free; each account's
 * first new lookups are free (GSTIN_FREE_LOOKUPS, 2 here), later ones cost a credit, only
 * when the app says to pay, and a failed lookup costs nothing.
 */
let server: Server;
let gstinServer: Server;
let base = "";
let lookups = 0;
const registered = new Set<string>();

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function withCheckDigit(first14: string) {
  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const product = CHARS.indexOf(first14[index]!) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return first14 + CHARS[(36 - (sum % 36)) % 36];
}
const gstin = (n: number) => withCheckDigit(`24AAAAA${String(n).padStart(4, "0")}A1Z`);

before(async () => {
  for (let n = 1; n <= 9; n++) registered.add(gstin(n));
  gstinServer = createServer((req, res) => {
    const id = /^\/v1\/gstin\/(.+)$/.exec(req.url ?? "")?.[1] ?? "";
    lookups += 1;
    res.setHeader("content-type", "application/json");
    if (!registered.has(id)) { res.writeHead(404); return res.end(JSON.stringify({ success: false, error: "GSTIN not found" })); }
    res.end(JSON.stringify({ success: true, gstin: id, data: { gstin: id, legal_name: "TEST TRADERS", trade_name: "TEST TRADERS", status: "Active", state_code: "24", address: "Rajkot", pincode: "360001" } }));
  });
  await new Promise<void>((resolve) => gstinServer.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    DATA_DIR: mkdtempSync(path.join(tmpdir(), "ewb-gstin-credits-")),
    GSTINAPI_KEY: "gak_credits_test",
    GSTINAPI_BASE_URL: `http://127.0.0.1:${(gstinServer.address() as AddressInfo).port}`,
    GSTIN_FREE_LOOKUPS: "2",
    WALLET_START_CREDITS: "1",
  });
  delete process.env["FIREBASE_PROJECT_ID"];
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => { server?.close(); gstinServer?.close(); });

async function verify(workspace: string, id: string, pay = false) {
  const response = await fetch(`${base}/gstin/verify`, { method: "POST", headers: { "content-type": "application/json", "x-workspace-id": workspace }, body: JSON.stringify({ gstin: id, ...(pay ? { pay: true } : {}) }) });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}
async function wallet(workspace: string) {
  return (await (await fetch(`${base}/wallet`, { headers: { "x-workspace-id": workspace } })).json()) as { balance: number; gstLookups: { free: number; used: number } };
}

describe("GSTIN verification credits", () => {
  it("gives the first new lookups free, then asks, then charges one credit, and stops at an empty wallet", async () => {
    const account = "gstin-credits-user-a";
    const first = await verify(account, gstin(1));
    assert.equal(first.status, 200);
    assert.equal(first.body.charged, 0);
    assert.equal(first.body.freeLeft, 1);
    assert.equal((await verify(account, gstin(2))).body.freeLeft, 0);

    const before = lookups;
    const asked = await verify(account, gstin(3));
    assert.equal(asked.status, 402);
    assert.equal(asked.body.error, "credit_needed");
    assert.equal(lookups, before, "no lookup before the user agrees to pay");

    const paid = await verify(account, gstin(3), true);
    assert.equal(paid.status, 200);
    assert.equal(paid.body.charged, 1);
    assert.equal((await wallet(account)).balance, 0);

    const short = await verify(account, gstin(4), true);
    assert.equal(short.status, 402);
    assert.equal(short.body.error, "insufficient_credits");
    assert.deepEqual((await wallet(account)).gstLookups, { free: 2, used: 3 });
  });

  it("is free for a GSTIN any account looked up before, without counting it", async () => {
    const again = await verify("gstin-credits-user-a", gstin(1));
    assert.equal(again.status, 200);
    assert.equal(again.body.charged, 0);
    const other = "gstin-credits-user-b";
    const known = await verify(other, gstin(3));
    assert.equal(known.body.charged, 0);
    assert.equal((await wallet(other)).gstLookups.used, 0);
  });

  it("does not count or charge a lookup that fails", async () => {
    const account = "gstin-credits-user-c";
    const missing = await verify(account, withCheckDigit("24ZZZZZ9999Z1Z"));
    assert.equal(missing.status, 404);
    assert.equal((await wallet(account)).gstLookups.used, 0);
  });
});
