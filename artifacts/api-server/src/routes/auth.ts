import { Router, type IRouter, type Response } from "express";
import { authMode, verifyIdToken } from "../lib/auth";
import { createEmailOtpService, OtpError } from "../lib/email-otp";
import { firebaseIdentity } from "../lib/identity";
import { mailer } from "../lib/mailer";
import { rateLimit } from "../lib/rate-limit";
import { withDoc } from "../lib/store";
import { logger } from "../lib/logger";
import { createHash } from "node:crypto";

/**
 * Email OTP registration (public; mounted before requireWorkspace):
 *   POST /auth/email-otp/send      { email }          → { cooldownSeconds }
 *   POST /auth/email-otp/verify    { email, code }    → { grant, expiresInSeconds }
 *   POST /auth/register/finalize   { grant } + Bearer → { activated }
 * Needs FIREBASE_PROJECT_ID, OTP_PEPPER, RESEND_API_KEY and EMAIL_FROM.
 */
const router: IRouter = Router();
const pepper = process.env["OTP_PEPPER"] ?? "";
const service = authMode === "firebase" && pepper.length >= 16
  ? createEmailOtpService({ store: withDoc, identity: firebaseIdentity, mailer, secret: pepper })
  : null;

function fail(res: Response, error: unknown) {
  if (error instanceof OtpError) {
    if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    return res.status(error.status).json({ error: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds });
  }
  return res.status(500).json({ error: "server_error", message: "Something went wrong. Try again." });
}

function unavailable(res: Response) {
  return res.status(503).json({ error: "not_configured", message: "Email verification is not set up on the server yet." });
}

// Per-IP limits on top of the per-email limits inside the service.
const sendLimit = rateLimit({ windowMs: 15 * 60_000, max: 10 });
const verifyLimit = rateLimit({ windowMs: 15 * 60_000, max: 30 });

/** Our page that sets the new password and then opens the app (hosting/auth/action.html). */
const SITE = (process.env["PUBLIC_SITE_URL"] ?? "https://ewb---generator.web.app").replace(/\/+$/, "");
const resetLimit = rateLimit({ windowMs: 15 * 60_000, max: 5 });
const RESET_COOLDOWN_MS = 60_000;

function resetEmail(link: string) {
  const green = "#175b42", gold = "#f2b230";
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#eef3f0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1b2420;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3e2da;">
<tr><td style="background:${green};padding:20px 24px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;"><img src="${SITE}/logo.png" width="44" height="44" alt="" style="display:block;border-radius:10px;"></td>
<td style="font-size:21px;font-weight:800;color:#fff;">E-Way <span style="color:${gold};">Easy</span></td></tr></table></td></tr>
<tr><td style="height:4px;background:${gold};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:24px;">
<div style="font-size:20px;font-weight:800;margin-bottom:8px;">Reset your password</div>
<div style="font-size:15px;line-height:1.55;color:#3c4a43;">We got a request to reset the password for your E-Way Easy account. Tap the button and choose a new password. The link works once and expires in 1 hour.</div>
<div style="margin:22px 0;"><a href="${link}" style="display:inline-block;background:${green};color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:13px 22px;border-radius:12px;">Set a new password</a></div>
<div style="font-size:13px;color:#5d6a63;line-height:1.5;">If you did not ask for this, ignore this email. Your password stays the same.</div>
</td></tr></table></body></html>`;
}

/**
 * Password reset email sent by us (Firebase's own template cannot be changed on this
 * project): the link opens our page, which saves the password and returns to the app.
 * Always answers the same way, so it does not reveal which emails have accounts.
 */
router.post("/auth/password-reset", resetLimit, async (req, res) => {
  if (authMode !== "firebase" || !mailer.configured) return res.status(503).json({ error: "not_configured", message: "Password reset email is not set up on the server." });
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return res.status(400).json({ error: "bad_request", message: "Enter a valid email address." });
  const done = () => res.json({ message: "If an account exists for this email, a reset link has been sent." });
  try {
    // One email a minute per address.
    const key = createHash("sha256").update(email).digest("hex");
    const allowed = await withDoc<{ at: number }, boolean>("password_resets", key, (current) =>
      current && Date.now() - current.at < RESET_COOLDOWN_MS ? { next: current, result: false } : { next: { at: Date.now() }, result: true });
    if (!allowed) return done();
    const user = await firebaseIdentity.getUserByEmail(email);
    if (!user || user.disabled) return done();
    if (!user.providers.includes("password")) {
      await mailer.send({ to: email, subject: "Your E-Way Easy sign-in", text: "Your E-Way Easy account signs in with Google, so it has no password to reset. Open the app and tap Continue with Google.", html: "<p>Your E-Way Easy account signs in with <b>Google</b>, so it has no password to reset.</p><p>Open the app and tap <b>Continue with Google</b>.</p>" });
      return done();
    }
    const link = `${SITE}/auth/action?mode=resetPassword&oobCode=${encodeURIComponent(await firebaseIdentity.passwordResetCode(email))}`;
    await mailer.send({ to: email, subject: "Reset your E-Way Easy password", text: `Reset your E-Way Easy password: ${link}

If you did not ask for this, ignore this email.`, html: resetEmail(link) });
    return done();
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Password reset email failed");
    return res.status(502).json({ error: "email_failed", message: "Could not send the reset email. Try again in a minute." });
  }
});

router.post("/auth/email-otp/send", sendLimit, async (req, res) => {
  if (!service) return unavailable(res);
  try {
    const result = await service.send(req.body?.email);
    return res.json({ message: "If this email can be registered, a 6-digit code has been sent.", ...result });
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/auth/email-otp/verify", verifyLimit, async (req, res) => {
  if (!service) return unavailable(res);
  try {
    return res.json(await service.verify(req.body?.email, req.body?.code));
  } catch (error) {
    return fail(res, error);
  }
});

router.post("/auth/register/finalize", verifyLimit, async (req, res) => {
  if (!service) return unavailable(res);
  const token = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1];
  if (!token) return res.status(401).json({ error: "auth_required", message: "Sign in to finish registration." });
  let claims;
  try {
    claims = await verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: "auth_invalid", message: "Your session expired. Try again." });
  }
  try {
    return res.json(await service.finalize(claims, req.body?.grant));
  } catch (error) {
    return fail(res, error);
  }
});

export default router;
