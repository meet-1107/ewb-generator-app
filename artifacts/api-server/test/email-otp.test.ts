import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { CODE_TTL_MS, createEmailOtpService, GRANT_TTL_MS, MAX_ATTEMPTS, MAX_SENDS_PER_HOUR, OtpError, RESEND_COOLDOWN_MS, type DocStore } from "../src/lib/email-otp";
import type { Identity, IdentityUser } from "../src/lib/identity";
import type { Email, Mailer } from "../src/lib/mailer";
import type { IdTokenClaims } from "../src/lib/auth";

/** In-memory DocStore with the same contract as store.withDoc (serialized, throw = no change). */
function memoryStore() {
  const docs = new Map<string, unknown>();
  let queue: Promise<unknown> = Promise.resolve();
  const store: DocStore = (collection, id, fn) => {
    const key = `${collection}/${id}`;
    const run = queue.catch(() => undefined).then(async () => {
      const current = docs.has(key) ? structuredClone(docs.get(key)) : null;
      const { next, result } = await fn(current as never);
      if (next === null) docs.delete(key);
      else docs.set(key, structuredClone(next));
      return result;
    });
    queue = run;
    return run;
  };
  return { store, docs };
}

let clock = 1_800_000_000_000;
let sent: Email[] = [];
let users: Map<string, IdentityUser>;
let verifiedUids: string[];
let mailFails = false;
let docs: Map<string, unknown>;
let service: ReturnType<typeof createEmailOtpService>;

const mailer: Mailer = { configured: true, async send(email) { if (mailFails) throw new Error("down"); sent.push(email); } };
const identity: Identity = {
  async getUserByEmail(email) { return users.get(email) ?? null; },
  async markEmailVerified(uid) { verifiedUids.push(uid); for (const user of users.values()) if (user.uid === uid) user.emailVerified = true; },
};
const lastCode = () => /(\d{6})/.exec(sent.at(-1)!.text)![1]!;
const claims = (over: Partial<IdTokenClaims> = {}): IdTokenClaims => ({ uid: "uid-1", email: "new@example.com", emailVerified: false, provider: "password", ...over });
async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof OtpError && error.code === code);
}

beforeEach(() => {
  clock = 1_800_000_000_000;
  sent = [];
  users = new Map();
  verifiedUids = [];
  mailFails = false;
  const memory = memoryStore();
  docs = memory.docs;
  service = createEmailOtpService({ store: memory.store, identity, mailer, secret: "test-pepper-0123456789", now: () => clock });
});

describe("email OTP registration", () => {
  it("sends a 6-digit code, verifies it once, and stores no plaintext", async () => {
    const { cooldownSeconds } = await service.send("  New@Example.com ");
    assert.equal(cooldownSeconds, RESEND_COOLDOWN_MS / 1000);
    assert.equal(sent[0]!.to, "new@example.com");
    const code = lastCode();
    assert.ok(!JSON.stringify([...docs.values()]).includes(code), "code must be stored hashed");
    const { grant } = await service.verify("new@example.com", code);
    assert.match(grant, /^[A-Za-z0-9_-]{43}$/);
    await rejects(service.verify("new@example.com", code), "invalid_code"); // replay
  });

  it("rejects malformed input", async () => {
    await rejects(service.send("not-an-email"), "invalid_email");
    await service.send("new@example.com");
    await rejects(service.verify("new@example.com", "12ab56"), "invalid_code");
  });

  it("expires codes after 5 minutes", async () => {
    await service.send("new@example.com");
    const code = lastCode();
    clock += CODE_TTL_MS + 1;
    await rejects(service.verify("new@example.com", code), "invalid_code");
  });

  it("locks a code after too many wrong attempts", async () => {
    await service.send("new@example.com");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await rejects(service.verify("new@example.com", wrong), "invalid_code");
    await rejects(service.verify("new@example.com", wrong), "too_many_attempts");
    await rejects(service.verify("new@example.com", code), "invalid_code"); // the right code no longer works
  });

  it("enforces the resend cooldown and the hourly limit", async () => {
    await service.send("new@example.com");
    await rejects(service.send("new@example.com"), "cooldown");
    for (let i = 1; i < MAX_SENDS_PER_HOUR; i++) {
      clock += RESEND_COOLDOWN_MS;
      await service.send("new@example.com");
    }
    clock += RESEND_COOLDOWN_MS;
    await rejects(service.send("new@example.com"), "too_many_codes");
    clock += 3_600_000;
    await service.send("new@example.com");
  });

  it("only the newest code is valid", async () => {
    await service.send("new@example.com");
    const first = lastCode();
    clock += RESEND_COOLDOWN_MS;
    await service.send("new@example.com");
    const second = lastCode();
    if (first !== second) await rejects(service.verify("new@example.com", first), "invalid_code");
    await service.verify("new@example.com", second);
  });

  it("does not reveal or allow re-registering an existing verified account", async () => {
    users.set("old@example.com", { uid: "uid-old", email: "old@example.com", emailVerified: true, disabled: false, providers: ["password"] });
    const result = await service.send("old@example.com");
    assert.equal(result.cooldownSeconds, 60); // same answer as a new email
    assert.match(sent[0]!.subject, /already have/);
    assert.ok(!/\d{6}/.test(sent[0]!.text));
    await rejects(service.verify("old@example.com", "123456"), "invalid_code");
  });

  it("lets an unfinished (unverified) registration verify again", async () => {
    users.set("new@example.com", { uid: "uid-1", email: "new@example.com", emailVerified: false, disabled: false, providers: ["password"] });
    await service.send("new@example.com");
    const { grant } = await service.verify("new@example.com", lastCode());
    assert.deepEqual(await service.finalize(claims(), grant), { activated: true, alreadyVerified: false });
    assert.deepEqual(verifiedUids, ["uid-1"]);
  });

  it("keeps nothing when the email cannot be sent", async () => {
    mailFails = true;
    await rejects(service.send("new@example.com"), "email_failed");
    mailFails = false;
    await service.send("new@example.com"); // no cooldown was recorded
  });

  it("keeps the earlier code working when a resend cannot be sent", async () => {
    await service.send("new@example.com");
    const first = lastCode();
    clock += RESEND_COOLDOWN_MS + 1;
    mailFails = true;
    await rejects(service.send("new@example.com"), "email_failed");
    mailFails = false;
    const { grant } = await service.verify("new@example.com", first);
    assert.match(grant, /^[A-Za-z0-9_-]{43}$/);
  });
});

describe("registration grants", () => {
  async function grantFor(email = "new@example.com") {
    await service.send(email);
    return (await service.verify(email, lastCode())).grant;
  }

  it("activates the matching account exactly once", async () => {
    const grant = await grantFor();
    await service.finalize(claims(), grant);
    await rejects(service.finalize(claims(), grant), "invalid_grant");
    assert.deepEqual(verifiedUids, ["uid-1"]);
  });

  it("is bound to the verified email", async () => {
    const grant = await grantFor();
    await rejects(service.finalize(claims({ uid: "uid-x", email: "other@example.com" }), grant), "invalid_grant");
    await service.finalize(claims(), grant); // still usable by the right account
  });

  it("expires after 15 minutes", async () => {
    const grant = await grantFor();
    clock += GRANT_TTL_MS + 1;
    await rejects(service.finalize(claims(), grant), "invalid_grant");
  });

  it("rejects guessed or Google grants and is idempotent once verified", async () => {
    await rejects(service.finalize(claims(), "x".repeat(43)), "invalid_grant");
    await rejects(service.finalize(claims({ provider: "google.com" }), "x".repeat(43)), "wrong_account");
    assert.deepEqual(await service.finalize(claims({ emailVerified: true }), undefined), { activated: true, alreadyVerified: true });
  });

  it("keeps the grant if activation fails, so the user can retry", async () => {
    const grant = await grantFor();
    const original = identity.markEmailVerified;
    identity.markEmailVerified = async () => { throw new Error("admin down"); };
    await rejects(service.finalize(claims(), grant), "unavailable");
    identity.markEmailVerified = original;
    await service.finalize(claims(), grant);
  });

  it("serializes concurrent finalize calls so a grant is used once", async () => {
    const grant = await grantFor();
    const results = await Promise.allSettled([service.finalize(claims(), grant), service.finalize(claims(), grant)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.deepEqual(verifiedUids, ["uid-1"]);
  });
});
