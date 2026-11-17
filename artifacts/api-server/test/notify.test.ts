import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("notifications", () => {
  it("saves a notice with the event, pushes it once and drops dead tokens", async () => {
    process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-notify-"));
    const { withWorkspace } = await import("../src/lib/store");
    const notify = await import("../src/lib/notify");
    const { settlePurchase } = await import("../src/routes/wallet");

    const sent: { tokens: string[]; title: string; badge: number }[] = [];
    notify.setPushSender(async (tokens, notice, badge) => {
      sent.push({ tokens, title: notice.title, badge });
      return { invalid: tokens.filter((token) => token.startsWith("dead")) };
    });

    await withWorkspace("ws-notify-1", (workspace) => {
      notify.saveToken(workspace, "phone-token-aaaaaaaaaaaaaaaa", "android");
      notify.saveToken(workspace, "dead-token-bbbbbbbbbbbbbbbbbb", "android");
      workspace.purchases["p1"] = { id: "p1", provider: "razorpay", credits: 100, amountPaise: 50_000, status: "created", createdAt: new Date().toISOString() };
      assert.equal(settlePurchase(workspace, "p1", "pay_1"), true);
      notify.noticeEwbGenerated(workspace, { id: "ewb-1", ewbNumber: "391000000001", invoiceNumber: "INV-7", buyerName: "Shree Traders", validUntil: "2026-11-18T18:29:59Z" });
    });
    await notify.pushNotices("ws-notify-1");

    assert.deepEqual(sent.map((item) => item.title), ["Payment received · ₹500", "E-way bill 391000000001 generated"]);
    assert.equal(sent[0]!.tokens.length, 2);
    assert.equal(sent[0]!.badge, 2);

    // Sent once only; the dead token is gone.
    await notify.pushNotices("ws-notify-1");
    assert.equal(sent.length, 2);
    const state = await withWorkspace("ws-notify-1", (workspace) => ({ tokens: Object.keys(workspace.pushTokens ?? {}), list: notify.noticeList(workspace) }));
    assert.deepEqual(state.tokens, ["phone-token-aaaaaaaaaaaaaaaa"]);
    assert.equal(state.list.unread, 2);
    assert.equal(state.list.notices[0]!.route, "ewb");
    assert.equal(state.list.notices[0]!.targetId, "ewb-1");
    assert.equal(state.list.notices[1]!.route, "wallet");
    assert.match(state.list.notices[1]!.body, /100 credits added/);
    notify.setPushSender(null);
  });

  it("keeps the newest 30 and shows 10", async () => {
    const notify = await import("../src/lib/notify");
    const workspace = { wallet: { balance: 0 } } as never as Parameters<typeof notify.addNotice>[0];
    for (let index = 0; index < 35; index++) notify.addNotice(workspace, { kind: "credits", route: "wallet", title: `n${index}`, body: "" });
    assert.equal(workspace.notices!.length, 30);
    const list = notify.noticeList(workspace);
    assert.equal(list.notices.length, 10);
    assert.equal(list.notices[0]!.title, "n34");
  });
});
