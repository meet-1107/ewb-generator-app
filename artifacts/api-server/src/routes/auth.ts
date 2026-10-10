import { Router, type IRouter, type Response } from "express";
import { authMode, verifyIdToken } from "../lib/auth";
import { createEmailOtpService, OtpError } from "../lib/email-otp";
import { firebaseIdentity } from "../lib/identity";
import { mailer } from "../lib/mailer";
import { rateLimit } from "../lib/rate-limit";
import { withDoc } from "../lib/store";

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
