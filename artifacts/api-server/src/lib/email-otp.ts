import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { IdTokenClaims } from "./auth";
import type { Identity } from "./identity";
import type { Email, Mailer } from "./mailer";

/**
 * Email OTP registration.
 *
 *   send(email)            six-digit code, valid 5 min, 60 s resend cooldown,
 *                          at most 5 codes per email per hour
 *   verify(email, code)    5 attempts per code; success consumes the code and
 *                          returns a random registration grant (15 min, single use)
 *   finalize(token, grant) the client has created (or signed in to) the
 *                          Firebase email/password account; the grant is
 *                          consumed and the account's email marked verified
 *
 * Codes and grants are stored only as HMAC/SHA-256 hashes, never logged.
 * Responses do not reveal whether an email already has an account: an
 * existing, verified account gets a "you already have an account" email
 * instead of a code, and the API answers the same way.
 */

export const CODE_TTL_MS = 5 * 60_000;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS_PER_HOUR = 5;
export const GRANT_TTL_MS = 15 * 60_000;

type Challenge = { codeHash: string | null; expiresAt: number; attempts: number; sends: number[] };
type Grant = { email: string; expiresAt: number };

export type DocStore = <T, R>(collection: string, id: string, fn: (current: T | null) => { next: T | null; result: R } | Promise<{ next: T | null; result: R }>) => Promise<R>;

export class OtpError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: unknown) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new OtpError("invalid_email", 400, "Enter a valid email address.");
  return email;
}

function codeEmail(code: string): Email {
  return {
    to: "",
    subject: `${code} is your E-Way Easy verification code`,
    text: `Your E-Way Easy verification code is ${code}.\n\nIt expires in 5 minutes. If you did not try to create an account, ignore this email.`,
    html: `<p>Your E-Way Easy verification code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 5 minutes. If you did not try to create an account, ignore this email.</p>`,
  };
}

function existingAccountEmail(google: boolean): Email {
  const how = google ? "Sign in with “Continue with Google”." : "Sign in with your password, or use “Forgot password?” to reset it.";
  return {
    to: "",
    subject: "You already have an E-Way Easy account",
    text: `Someone (probably you) tried to create an E-Way Easy account with this email, but an account already exists.\n\n${how}\n\nIf this was not you, you can ignore this email.`,
    html: `<p>Someone (probably you) tried to create an E-Way Easy account with this email, but an account already exists.</p><p>${how}</p><p>If this was not you, you can ignore this email.</p>`,
  };
}

export function createEmailOtpService(deps: { store: DocStore; identity: Identity; mailer: Mailer; secret: string; now?: () => number }) {
  const now = deps.now ?? Date.now;
  if (deps.secret.length < 16) throw new Error("OTP_PEPPER must be at least 16 characters.");
  const keyFor = (email: string) => createHmac("sha256", deps.secret).update(`key:${email}`).digest("hex");
  const hashCode = (email: string, code: string) => createHmac("sha256", deps.secret).update(`code:${email}:${code}`).digest("hex");
  const grantId = (grant: string) => createHash("sha256").update(grant).digest("hex");

  async function send(rawEmail: unknown) {
    const email = normalizeEmail(rawEmail);
    if (!deps.mailer.configured) throw new OtpError("email_not_configured", 503, "Email verification is not set up on the server yet.");
    let existing;
    try {
      existing = await deps.identity.getUserByEmail(email);
    } catch {
      throw new OtpError("unavailable", 503, "Could not start verification right now. Try again in a minute.");
    }
    const alreadyActive = Boolean(existing && (existing.emailVerified || existing.disabled || existing.providers.includes("google.com")));

    return deps.store<Challenge, { cooldownSeconds: number }>("auth-otp", keyFor(email), async (current) => {
      const at = now();
      const sends = (current?.sends ?? []).filter((time) => at - time < 3_600_000);
      const last = sends[sends.length - 1];
      if (last !== undefined && at - last < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - (at - last)) / 1000);
        throw new OtpError("cooldown", 429, `Wait ${wait} seconds before asking for another code.`, wait);
      }
      if (sends.length >= MAX_SENDS_PER_HOUR) {
        const wait = Math.ceil((3_600_000 - (at - sends[0]!)) / 1000);
        throw new OtpError("too_many_codes", 429, "Too many codes requested for this email. Try again later.", wait);
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const message = alreadyActive ? existingAccountEmail(Boolean(existing?.providers.includes("google.com"))) : codeEmail(code);
      try {
        await deps.mailer.send({ ...message, to: email });
      } catch {
        throw new OtpError("email_failed", 502, "We could not send the email. Check the address and try again.");
      }
      return {
        // An existing account gets no usable code.
        next: { codeHash: alreadyActive ? null : hashCode(email, code), expiresAt: at + CODE_TTL_MS, attempts: 0, sends: [...sends, at] },
        result: { cooldownSeconds: RESEND_COOLDOWN_MS / 1000 },
      };
    });
  }

  async function verify(rawEmail: unknown, rawCode: unknown) {
    const email = normalizeEmail(rawEmail);
    const code = String(rawCode ?? "").trim();
    const invalid = new OtpError("invalid_code", 400, "That code is incorrect or has expired.");
    if (!/^\d{6}$/.test(code)) throw invalid;

    const outcome = await deps.store<Challenge, "ok" | "invalid" | "locked">("auth-otp", keyFor(email), (current) => {
      const at = now();
      if (!current || !current.codeHash || at > current.expiresAt) return { next: current ? { ...current, codeHash: null } : null, result: "invalid" };
      if (current.attempts >= MAX_ATTEMPTS) return { next: { ...current, codeHash: null }, result: "locked" };
      const expected = Buffer.from(current.codeHash, "hex");
      const actual = Buffer.from(hashCode(email, code), "hex");
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
        // Consumed: the same code can never be used again.
        return { next: { ...current, codeHash: null }, result: "ok" };
      }
      const attempts = current.attempts + 1;
      return { next: { ...current, attempts, codeHash: attempts >= MAX_ATTEMPTS ? null : current.codeHash }, result: attempts >= MAX_ATTEMPTS ? "locked" : "invalid" };
    });
    if (outcome === "locked") throw new OtpError("too_many_attempts", 429, "Too many wrong codes. Request a new code.");
    if (outcome !== "ok") throw invalid;

    const grant = randomBytes(32).toString("base64url");
    await deps.store<Grant, null>("auth-grants", grantId(grant), () => ({ next: { email, expiresAt: now() + GRANT_TTL_MS }, result: null }));
    return { grant, expiresInSeconds: GRANT_TTL_MS / 1000 };
  }

  /** Activates the signed-in email/password account the grant was issued for. Idempotent once verified. */
  async function finalize(claims: IdTokenClaims, rawGrant: unknown) {
    if (claims.emailVerified) return { activated: true, alreadyVerified: true };
    if (claims.provider !== "password" || !claims.email) throw new OtpError("wrong_account", 400, "Finish registration with the email and password you signed up with.");
    const grant = String(rawGrant ?? "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(grant)) throw new OtpError("invalid_grant", 400, "Your verification has expired. Verify your email again.");
    const email = claims.email;

    return deps.store<Grant, { activated: true; alreadyVerified: false }>("auth-grants", grantId(grant), async (current) => {
      if (!current || now() > current.expiresAt) throw new OtpError("invalid_grant", 400, "Your verification has expired. Verify your email again.");
      if (current.email !== email) throw new OtpError("invalid_grant", 400, "This verification belongs to a different email.");
      try {
        await deps.identity.markEmailVerified(claims.uid);
      } catch {
        // Keep the grant so the user can retry.
        throw new OtpError("unavailable", 503, "Could not activate your account right now. Try again.");
      }
      return { next: null, result: { activated: true, alreadyVerified: false } };
    });
  }

  return { send, verify, finalize };
}
