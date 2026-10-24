import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/** App opens and daily active users for the admin panel. Sandbox auth, JSON-file store. */
let server: Server;
let base = "";
const open = (workspace: string, body: unknown = { platform: "android", appVersion: "1.3.3" }) =>
  fetch(`${base}/api/activity/open`, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspace }, body: JSON.stringify(body) });

before(async () => {
  process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-activity-"));
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

describe("App activity", () => {
  it("records app opens and counts active users and opens per day", async () => {
    assert.equal((await open("activity-user-a")).status, 204);
    assert.equal((await open("activity-user-a")).status, 204);
    assert.equal((await open("activity-user-b", { platform: "ios", appVersion: "1.3.3" })).status, 204);
    const { activity } = await import("../src/lib/admin-data");
    const now = Date.now();
    const result = await activity({ from: new Date(now - 2 * 86_400_000).toISOString(), to: new Date(now + 60_000).toISOString() });
    const ours = result.users.filter((user) => user.uid.endsWith("activity-user-a") || user.uid.endsWith("activity-user-b"));
    assert.equal(ours.length, 2);
    assert.equal(ours.find((user) => user.uid.endsWith("activity-user-a"))?.opens, 2);
    assert.equal(ours.find((user) => user.uid.endsWith("activity-user-b"))?.platform, "ios");
    assert.equal(result.summary.activeToday, 2);
    assert.equal(result.summary.opensToday, 3);
    assert.equal(result.activeSeries.at(-1)?.value, 2);
    assert.equal(result.opensSeries.at(-1)?.value, 3);
  });

  it("rejects an unknown platform", async () => {
    assert.equal((await open("activity-user-c", { platform: "toaster", appVersion: "1" })).status, 400);
  });
});
