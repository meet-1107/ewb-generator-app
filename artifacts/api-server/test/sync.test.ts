import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/** POST /api/sync between two devices of one account. Sandbox auth, JSON-file store. */
let server: Server;
let base = "";
const WS = "sync-user-two-devices";
const sync = async (since: string | undefined, collections: Record<string, unknown[]>) =>
  (await (await fetch(`${base}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": WS }, body: JSON.stringify({ since, collections }) })).json()) as { serverTime: string; changes: Record<string, { id: string; updatedAt: string; deleted?: boolean }[]> };

before(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-sync-"));
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

describe("sync between two devices", () => {
  it("delivers a change made offline earlier but uploaded after the other device last synced", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    // Phone A syncs now.
    const a1 = await sync(undefined, { parties: [{ id: "p1", updatedAt: new Date().toISOString(), data: { name: "A" } }] });
    // Phone B edited offline yesterday and uploads only now; it also deletes p1 (deleted yesterday).
    await sync(undefined, { parties: [{ id: "p2", updatedAt: yesterday, data: { name: "B offline edit" } }] });
    // Phone A's next sync must receive B's change, although its updatedAt is older than A's last sync.
    const a2 = await sync(a1.serverTime, {});
    assert.ok(a2.changes["parties"]?.some((record) => record.id === "p2"), JSON.stringify(a2.changes));
    // And nothing is sent again once A has it.
    const a3 = await sync(a2.serverTime, {});
    assert.equal(a3.changes["parties"]?.length ?? 0, 0);
  });
});
