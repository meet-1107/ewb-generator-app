import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Before the store is first imported: it reads DATA_DIR once.
process.env["DATA_DIR"] = mkdtempSync(path.join(tmpdir(), "ewb-support-"));

describe("support chat", () => {
  it("answers by topic and always promises a reply within 24 hours", async () => {
    const { botReply, OFF_TOPIC_REPLY, TEAM_PROMISE } = await import("../src/lib/support");
    assert.equal(botReply("my eway bill username password is invalid").topic, "ewb_login");
    assert.equal(botReply("money debited but no credits").topic, "payment");
    assert.equal(botReply("how many credits for one bill").topic, "credits");
    assert.equal(botReply("e-way bill rejected with error").topic, "ewb_generate");
    assert.equal(botReply("hello").topic, "other");
    assert.equal(botReply("hello", "payment").topic, "payment");
    assert.equal(botReply("hello").text, OFF_TOPIC_REPLY);
    assert.equal(botReply("how to create api username").guide, "ewb_login");
    assert.equal(botReply("payment failed").guide, undefined);
    assert.equal(botReply("payment issue", "other").text, OFF_TOPIC_REPLY);
    assert.ok(botReply("payment failed").text.includes(TEAM_PROMISE));
  });

  it("keeps the thread, the team's reply and what the user has seen", async () => {
    const support = await import("../src/lib/support");
    const who = { uid: "ws-support-1", email: "a@b.in", name: "A", businessName: "Shree", gstin: null };
    let thread = await support.addUserMessage(who, "payment done but credits not added");
    assert.equal(thread.messages.length, 2);
    assert.deepEqual(thread.messages.map((item) => item.from), ["user", "bot"]);
    assert.equal(thread.status, "open");
    assert.equal(thread.topic, "payment");

    const sent = (await support.addAdminReply(who.uid, "Credits added, please check.", "admin@ewayeasy.in"))!;
    assert.ok(sent.ok);
    thread = sent.ok ? sent.thread : thread;
    assert.equal(thread.status, "replied");
    assert.equal(thread.unreadForUser, 1);
    assert.equal((await support.markSeenByUser(who.uid))!.unreadForUser, 0);

    await support.setThreadStatus(who.uid, "closed");
    thread = await support.addUserMessage(who, "one more question");
    assert.equal(thread.status, "open");
    assert.equal(thread.messages.length, 5);
    assert.ok((await support.listThreads()).length >= 1);
    assert.equal(await support.addAdminReply("nobody", "x", "a@b.in"), null);

    // The team can write first, and at most 10 times a day to one user.
    const fresh = { uid: "ws-support-2", email: "c@d.in", name: null, businessName: null, gstin: null };
    for (let index = 0; index < support.ADMIN_MESSAGES_PER_DAY; index++) assert.ok((await support.addAdminReply(fresh.uid, "Hello " + index, "admin@ewayeasy.in", fresh))!.ok);
    const blocked = (await support.addAdminReply(fresh.uid, "one more", "admin@ewayeasy.in", fresh))!;
    assert.equal(blocked.ok, false);
    assert.equal((await support.readThread(fresh.uid))!.messages.length, support.ADMIN_MESSAGES_PER_DAY);
  });
});
