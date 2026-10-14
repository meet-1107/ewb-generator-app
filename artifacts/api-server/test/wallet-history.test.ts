import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HISTORY_PAGE, walletHistory, walletSummary } from "../src/lib/wallet";

// 45 top-ups, one a day from 1 Sep 2026: ids e0 (oldest) … e44 (newest).
const ledger = Array.from({ length: 45 }, (_, index) => ({
  id: `e${index}`,
  at: new Date(Date.UTC(2026, 8, 1 + index, 6)).toISOString(),
  kind: "purchase",
  credits: 10,
  status: "charged",
}));
const workspace = { wallet: { balance: 450, ledger } } as unknown as Parameters<typeof walletHistory>[0];

describe("wallet history pages", () => {
  it("sends only the first page with the wallet, and says more follow", () => {
    const summary = walletSummary(workspace);
    assert.equal(summary.ledger.length, HISTORY_PAGE);
    assert.equal(summary.ledger[0]!.id, "e44");
    assert.equal(summary.ledgerMore, true);
  });

  it("loads each next page after the last entry shown, newest first", () => {
    const second = walletHistory(workspace, "", { before: "e25", limit: 20 });
    assert.deepEqual(second.entries.map((entry) => entry.id), Array.from({ length: 20 }, (_, index) => `e${24 - index}`));
    assert.equal(second.more, true);
    const last = walletHistory(workspace, "", { before: "e5", limit: 20 });
    assert.deepEqual(last.entries.map((entry) => entry.id), ["e4", "e3", "e2", "e1", "e0"]);
    assert.equal(last.more, false);
  });

  it("pages within one month, and still returns a whole month to older apps", () => {
    const october = walletHistory(workspace, "2026-10", { limit: 10 });
    assert.equal(october.entries[0]!.id, "e44");
    assert.equal(october.entries.length, 10);
    assert.equal(october.more, true);
    assert.equal(walletHistory(workspace, "2026-09").entries.length, 30);
  });
});
