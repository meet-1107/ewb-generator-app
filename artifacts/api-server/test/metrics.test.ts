import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Before the store is first imported: it reads DATA_DIR once.
process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-metrics-"));

describe("admin counters and user index", () => {
  it("counts each event once, keeps the account index, and pages users", async () => {
    const store = await import("../src/lib/store");
    const metrics = await import("../src/lib/metrics");
    const counters = await import("../src/lib/admin-counters");
    const { settlePurchase } = await import("../src/routes/wallet");

    // A new account: its first write is a sign-up.
    await store.withWorkspace("acct-one-0000001", (workspace) => {
      workspace.purchases["p1"] = { id: "p1", provider: "razorpay", credits: 100, amountPaise: 10_000, status: "created", createdAt: new Date().toISOString() };
      settlePurchase(workspace, "p1", "pay_1");
      metrics.bump(workspace, "ewbsGenerated");
      metrics.bump(workspace, "invoices");
    });
    // Settling again does nothing (and counts nothing).
    await store.withWorkspace("acct-one-0000001", (workspace) => { settlePurchase(workspace, "p1", "pay_1"); });
    await store.withWorkspace("acct-two-0000002", (workspace) => { metrics.bump(workspace, "invoices", 1); });

    const now = new Date().toISOString();
    const c = await counters.counters({ from: now, to: now });
    assert.equal(c.inRange.signups, 2);
    assert.equal(c.inRange.paymentsPaid, 1);
    assert.equal(c.inRange.paidPaise, 10_000);
    assert.equal(c.inRange.creditsSold, 100);
    assert.equal(c.inRange.ewbsGenerated, 1);
    assert.equal(c.inRange.invoices, 2);
    assert.equal(c.allTime.invoices, 2);

    const page = await store.queryUserIndex({ orderBy: "createdAt", direction: "desc", limit: 1 });
    assert.equal(page.total, 2);
    assert.equal(page.rows.length, 1);
    assert.ok(page.next);
    const second = await store.queryUserIndex({ orderBy: "createdAt", direction: "desc", limit: 1, after: page.next! });
    assert.equal(second.rows.length, 1);
    assert.notEqual(second.rows[0]!.uid, page.rows[0]!.uid);

    const paid = await store.queryUserIndex({ where: { field: "paidPaise", op: ">", value: 0 }, orderBy: "createdAt", direction: "desc", limit: 50 });
    assert.deepEqual(paid.rows.map((row) => row.uid), ["acct-one-0000001"]);
    assert.equal(paid.rows[0]!.balance, 100);
    assert.equal(paid.rows[0]!.ewbTotal, 1);
  });

  it("rebuilds counters and the index from stored data", async () => {
    const store = await import("../src/lib/store");
    const { rebuildPage } = await import("../src/lib/metrics-rebuild");
    const counters = await import("../src/lib/admin-counters");
    let result = await rebuildPage({ reset: true, limit: 1 });
    let pages = 1;
    while (result.next) { result = await rebuildPage({ after: result.next, limit: 1 }); pages += 1; }
    assert.ok(pages >= 2);
    const now = new Date().toISOString();
    const c = await counters.counters({ from: now, to: now });
    // Rebuilt from history: both sign-ups and the paid purchase.
    assert.equal(c.allTime.signups, 2);
    assert.equal(c.allTime.paymentsPaid, 1);
    const index = await store.queryUserIndex({ orderBy: "createdAt", direction: "desc", limit: 50 });
    assert.equal(index.total, 2);
  });
});
