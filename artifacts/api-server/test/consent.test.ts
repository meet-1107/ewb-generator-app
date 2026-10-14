import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/** Terms & Privacy consent: GET/POST /api/consent. Sandbox auth (x-workspace-id), JSON-file store. */
let server: Server;
let base = "";
const call = (method: string, body?: unknown, workspace = "consent-user-1") =>
  fetch(`${base}/api/consent`, { method, headers: { "Content-Type": "application/json", "x-workspace-id": workspace, "user-agent": "consent-test" }, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-consent-"));
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

describe("Terms & Privacy consent", () => {
  it("is required until the account accepts the current version, and is recorded per account", async () => {
    const first = await (await call("GET")).json() as { version: string; accepted: unknown; required: boolean };
    assert.equal(first.required, true);
    assert.equal(first.accepted, null);

    const outdated = await call("POST", { version: "2020-01-01", method: "signup" });
    assert.equal(outdated.status, 409);

    const saved = await call("POST", { version: first.version, method: "signup" });
    assert.equal(saved.status, 200);
    const after = await (await call("GET")).json() as { accepted: { version: string; acceptedAt: string } | null; required: boolean };
    assert.equal(after.required, false);
    assert.equal(after.accepted?.version, first.version);

    // Another account is unaffected.
    const other = await (await call("GET", undefined, "consent-user-2")).json() as { required: boolean };
    assert.equal(other.required, true);
  });

  it("rejects an unknown sign-up method", async () => {
    const response = await call("POST", { version: "2026-10-15", method: "email-click" });
    assert.equal(response.status, 400);
  });
});
