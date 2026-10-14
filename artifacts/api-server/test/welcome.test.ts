import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/** Free trial credits: once per GSTIN and once per account. Sandbox auth, JSON-file store. */
let server: Server;
let base = "";
const call = (method: string, pathname: string, workspace: string, body?: unknown) =>
  fetch(`${base}/api${pathname}`, { method, headers: { "Content-Type": "application/json", "x-workspace-id": workspace }, body: body === undefined ? undefined : JSON.stringify(body) });
const saveLogin = async (workspace: string, gstin: string) =>
  (await (await call("PUT", "/ewb-credentials", workspace, { gstin, username: "api_user", password: "secret" })).json()) as { welcomeCredits: number; balance?: number };
const wallet = async (workspace: string) => (await (await call("GET", "/wallet", workspace)).json()) as { balance: number; welcomeCredits: number };

before(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-welcome-"));
  process.env["EWB_CREDENTIALS_SECRET"] = "test-secret-0123456789";
  process.env["WALLET_START_CREDITS"] = "0";
  process.env["WELCOME_CREDITS"] = "10";
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

describe("Free trial credits", () => {
  it("are given once for a GSTIN, never again to another account with the same GSTIN", async () => {
    assert.deepEqual(await wallet("welcome-user-a"), { ...(await wallet("welcome-user-a")), balance: 0, welcomeCredits: 10 });
    const first = await saveLogin("welcome-user-a", "24AAACR5055K1ZD");
    assert.equal(first.welcomeCredits, 10);
    assert.equal((await wallet("welcome-user-a")).balance, 10);
    assert.equal((await wallet("welcome-user-a")).welcomeCredits, 0);

    // Saving the same login again does not add more.
    assert.equal((await saveLogin("welcome-user-a", "24AAACR5055K1ZD")).welcomeCredits, 0);
    // A new account with the same GSTIN gets nothing.
    assert.equal((await saveLogin("welcome-user-b", "24AAACR5055K1ZD")).welcomeCredits, 0);
    assert.equal((await wallet("welcome-user-b")).balance, 0);
  });

  it("are given once per account, even with a second GSTIN", async () => {
    assert.equal((await saveLogin("welcome-user-c", "24AAGCP5430N1Z8")).welcomeCredits, 10);
    assert.equal((await saveLogin("welcome-user-c", "24ABIFR9607F1Z2")).welcomeCredits, 0);
    assert.equal((await wallet("welcome-user-c")).balance, 10);
  });
});
