import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The Firestore side of the admin counters (transactions, increments, count and paged queries).
// Runs against the emulator, like store-firestore.test.ts.
if (process.env["FIRESTORE_EMULATOR_HOST"]) {
  process.env["STORE"] = "firestore";
  process.env["FIREBASE_PROJECT_ID"] ||= "demo-ewb";
  describe("admin counters on Firestore", () => {
    it("counts in the transaction, indexes accounts and pages them", async () => {
      const store = await import("../src/lib/store");
      const metrics = await import("../src/lib/metrics");
      const counters = await import("../src/lib/admin-counters");
      const run = `m${Date.now().toString(36)}`;
      for (let index = 0; index < 3; index++) {
        await store.withWorkspace(`${run}-acct-${index}`, (workspace) => {
          metrics.bump(workspace, "ewbsGenerated");
          if (index === 0) metrics.bump(workspace, "paidPaise", 5_000);
        });
      }
      const now = new Date().toISOString();
      const c = await counters.counters({ from: now, to: now });
      assert.ok(c.inRange.signups >= 3);
      assert.ok(c.inRange.ewbsGenerated >= 3);
      assert.ok(c.allTime.paidPaise >= 5_000);

      const mine = await store.queryUserIndex({ where: { field: "uid", op: ">=", value: run }, orderBy: "uid", direction: "asc", limit: 2 });
      assert.ok(mine.total >= 3);
      assert.equal(mine.rows.length, 2);
      const next = await store.queryUserIndex({ where: { field: "uid", op: ">=", value: run }, orderBy: "uid", direction: "asc", limit: 2, after: mine.next! });
      assert.ok(next.rows.length >= 1);
      assert.ok(next.rows[0]!.uid > mine.rows[1]!.uid);
      const paid = await store.queryUserIndex({ where: { field: "paidPaise", op: ">", value: 0 }, orderBy: "createdAt", direction: "desc", limit: 50 });
      assert.ok(paid.rows.some((row) => row.uid === `${run}-acct-0`));
      const page = await store.workspaceIdPage(undefined, 2);
      assert.equal(page.length, 2);
    });
  });
} else {
  it("admin counters on Firestore (skipped: FIRESTORE_EMULATOR_HOST is not set)", { skip: true }, () => {});
}
