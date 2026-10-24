import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/** The e-way bill list: everything without `since`, only changed bills with it. Sandbox auth, JSON-file store. */
let server: Server;
let base = "";
let dataDir = "";
type List = { ewbs: { id: string; status: string; changedAt?: string }[]; full: boolean; serverTime: string };
const list = async (workspace: string, since?: string) =>
  (await (await fetch(`${base}/api/ewb${since ? `?since=${encodeURIComponent(since)}` : ""}`, { headers: { "x-workspace-id": workspace } })).json()) as List;
const bill = (id: string, validUntil = new Date(Date.now() + 86_400_000).toISOString()) => ({
  id, invoiceId: `inv-${id}`, invoiceNumber: id, ewbNumber: `EWB-${id}`, status: "active", generatedAt: "2026-10-01T10:00:00.000Z", validUntil, history: [],
});

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "ewb-list-"));
  process.env["DATA_DIR"] = dataDir;
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

describe("E-way bill list", () => {
  it("sends every bill without `since`, then only bills changed after it", async () => {
    const workspace = "ewb-list-user-a";
    // Bills saved before `changedAt` existed.
    mkdirSync(path.join(dataDir, "workspaces"), { recursive: true });
    writeFileSync(path.join(dataDir, "workspaces", `sbx_${workspace}.json`), JSON.stringify({ id: `sbx_${workspace}`, ewbs: { a: bill("a"), b: bill("b") } }));

    const full = await list(workspace);
    assert.equal(full.full, true);
    assert.deepEqual(full.ewbs.map((ewb) => ewb.id).sort(), ["a", "b"]);
    // The full read stamps the old bills, so later `since` lists can find them when they change.
    assert.ok(full.ewbs.every((ewb) => ewb.changedAt));

    // Within the overlap window the same bills come again (harmless: the app merges by id).
    const soon = await list(workspace, full.serverTime);
    assert.equal(soon.full, false);
    assert.ok(soon.ewbs.length <= 2);

    // Well after the last change: nothing changed, nothing sent.
    const later = new Date(Date.now() + 10 * 60_000).toISOString();
    assert.deepEqual((await list(workspace, later)).ewbs, []);

    // A change after `since` is sent, alone. The server reads from `since` less its overlap,
    // so asking from `mid` + overlap reads the bills changed after `mid`.
    const { withWorkspace } = await import("../src/lib/store");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mid = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Sandbox workspaces are stored as `sbx_` + the device id.
    await withWorkspace(`sbx_${workspace}`, (ws) => { ws.ewbs["b"]!.status = "cancelled"; }, { ewbs: ["b"] });
    const changed = await list(workspace, new Date(mid + 5 * 60_000).toISOString());
    assert.deepEqual(changed.ewbs.map((ewb) => `${ewb.id}:${ewb.status}`), ["b:cancelled"]);
  });

  it("ignores a `since` that is not a date", async () => {
    const result = await list("ewb-list-user-b", "yesterday");
    assert.equal(result.full, true);
    assert.deepEqual(result.ewbs, []);
  });
});
