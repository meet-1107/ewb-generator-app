import { Router, type IRouter } from "express";
import { GstinApiError, gstinApiConfigured } from "../lib/gstinapi";
import { verifyGstin } from "../lib/gstin-registry";
import { gstinProblem } from "../lib/validation";
import { rateLimit } from "../lib/rate-limit";

const router: IRouter = Router();

/**
 * Verifies a GSTIN and returns its registered details. Each GSTIN is fetched
 * from gstinapi.in once and then served from the shared registry. Free for
 * users; the check digit is validated first so typos never reach the API.
 */
// Each new GSTIN costs one paid lookup: cap how many one account can make.
router.post("/gstin/verify", rateLimit({ windowMs: 60 * 60_000, max: 100, by: "workspace" }), async (req, res) => {
  const gstin = String(req.body?.gstin ?? "").trim().toUpperCase();
  const problem = gstinProblem(gstin);
  if (problem) return res.status(400).json({ error: "invalid_gstin", message: problem });
  if (!gstinApiConfigured) return res.status(503).json({ error: "not_configured", message: "GSTIN verification is not set up on the server yet." });
  try {
    const { record, cached, stale } = await verifyGstin(gstin);
    return res.json({ gstin: record, cached, stale: Boolean(stale) });
  } catch (error) {
    if (error instanceof GstinApiError) {
      if (error.code === "NOT_FOUND") return res.status(404).json({ error: "not_found", message: "This GSTIN is not registered with the GST network." });
      if (error.code === "INVALID_FORMAT") return res.status(400).json({ error: "invalid_gstin", message: "That does not look like a valid GSTIN." });
      if (error.code === "RATE_LIMITED") return res.status(429).json({ error: "rate_limited", message: "Too many verifications right now. Try again in a minute." });
    }
    req.log?.error({ err: (error as Error).message }, "GSTIN verification failed");
    return res.status(502).json({ error: "verification_unavailable", message: "GSTIN verification is temporarily unavailable. You can fill the details by hand." });
  }
});

export default router;
