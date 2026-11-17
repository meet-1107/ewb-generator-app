import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { invoiceStats } from "../src/lib/admin-data";

describe("admin invoice counts", () => {
  it("counts saved sales invoices, purchase bills and drafts; skips deleted and unsaved", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    const rec = (id: string, data: Record<string, unknown> | undefined, deleted = false) => ({ id, updatedAt: "2026-11-01T00:00:00Z", deleted, data });
    const workspace = { sync: { invoices: {
      a: rec("a", { kind: "sale", status: "ready", createdAt: "2026-11-15T10:00:00Z" }),
      b: rec("b", { kind: "sale", status: "ewb_generated", createdAt: "2026-09-01T10:00:00Z" }),
      c: rec("c", { kind: "purchase", status: "ready", createdAt: "2026-11-10T10:00:00Z" }),
      d: rec("d", { kind: "sale", status: "draft", createdAt: "2026-11-16T10:00:00Z" }),
      e: rec("e", { kind: "sale", status: "ready", unsaved: true, createdAt: "2026-11-16T10:00:00Z" }),
      f: rec("f", undefined, true),
    } } } as never;
    assert.deepEqual(invoiceStats(workspace, now), { sales: 2, purchases: 1, drafts: 1, last30: 2, lastAt: "2026-11-15T10:00:00Z" });
    assert.deepEqual(invoiceStats(undefined, now), { sales: 0, purchases: 0, drafts: 0, last30: 0, lastAt: null });
  });
});
