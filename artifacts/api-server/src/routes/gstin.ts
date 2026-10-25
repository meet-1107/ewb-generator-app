import { Router, type IRouter } from "express";
import { GstinApiError, gstinApiConfigured } from "../lib/gstinapi";
import { isKnownGstin, verifyGstin } from "../lib/gstin-registry";
import { gstinProblem } from "../lib/validation";
import { rateLimit } from "../lib/rate-limit";
import { withWorkspace } from "../lib/store";
import { creditCosts, FREE_GST_LOOKUPS, holdCredits, refundCredits, settleCredits } from "../lib/wallet";

const router: IRouter = Router();

/**
 * Verifies a GSTIN and returns its registered details. Each GSTIN is fetched
 * from gstinapi.in once and then served from the shared registry; the check
 * digit is validated first so typos never reach the API.
 *
 * A GSTIN already in the registry (looked up by any account) is always free.
 * Only a GSTIN never looked up before costs a paid lookup: each account gets
 * FREE_GST_LOOKUPS of those free, then each costs gst_verify credits. Those
 * are charged only with `pay: true` (the app asks first), so a lookup the app
 * starts by itself never spends credits unasked. A failed lookup costs nothing.
 */
router.post("/gstin/verify", rateLimit({ windowMs: 60 * 60_000, max: 100, by: "workspace" }), async (req, res) => {
  const gstin = String(req.body?.gstin ?? "").trim().toUpperCase();
  const problem = gstinProblem(gstin);
  if (problem) return res.status(400).json({ error: "invalid_gstin", message: problem });
  if (!gstinApiConfigured) return res.status(503).json({ error: "not_configured", message: "GSTIN verification is not set up on the server yet." });
  const pay = req.body?.pay === true;
  const cost = creditCosts.gst_verify;

  // A new lookup: counted against the free ones, or paid for (credits held until it succeeds).
  type Plan = { kind: "free"; counted: boolean; freeLeft: number } | { kind: "paid"; entryId: string | null } | { kind: "ask" | "short"; balance: number };
  let plan: Plan = { kind: "free", counted: false, freeLeft: -1 };
  if (!(await isKnownGstin(gstin))) {
    plan = await withWorkspace(req.workspaceId, (workspace): Plan => {
      const lookups = (workspace.gstLookups ??= {});
      if (lookups[gstin]) return { kind: "free", counted: false, freeLeft: Math.max(0, FREE_GST_LOOKUPS - Object.keys(lookups).length) };
      const used = Object.keys(lookups).length;
      if (used < FREE_GST_LOOKUPS || !cost) {
        lookups[gstin] = new Date().toISOString();
        return { kind: "free", counted: true, freeLeft: Math.max(0, FREE_GST_LOOKUPS - used - 1) };
      }
      if (!pay) return { kind: "ask", balance: workspace.wallet.balance };
      const hold = holdCredits(workspace, "gst_verify", gstin);
      if (!hold.ok) return { kind: "short", balance: hold.balance };
      lookups[gstin] = new Date().toISOString();
      return { kind: "paid", entryId: hold.entryId };
    });
  }
  if (plan.kind === "ask") {
    return res.status(402).json({ error: "credit_needed", cost, balance: plan.balance, free: FREE_GST_LOOKUPS, message: `Your ${FREE_GST_LOOKUPS} free GSTIN verifications are used. Verifying a new GSTIN costs ${cost} credit${cost === 1 ? "" : "s"}.` });
  }
  if (plan.kind === "short") {
    return res.status(402).json({ error: "insufficient_credits", cost, balance: plan.balance, message: `Verifying a new GSTIN costs ${cost} credit${cost === 1 ? "" : "s"}. Your wallet has ${plan.balance}. Add credits to continue.` });
  }

  /** Takes back the count (and refunds a paid lookup) when the account did not pay for a lookup after all. */
  const undo = async (note: string) => {
    if (plan.kind === "free" && !plan.counted) return;
    await withWorkspace(req.workspaceId, (workspace) => {
      if (workspace.gstLookups) delete workspace.gstLookups[gstin];
      if (plan.kind === "paid") refundCredits(workspace, plan.entryId, note);
    });
  };

  try {
    const { record, cached, stale } = await verifyGstin(gstin);
    // Another account looked it up meanwhile: no lookup was made for this one.
    if (cached) await undo("Already verified: no charge");
    else if (plan.kind === "paid") await withWorkspace(req.workspaceId, (workspace) => settleCredits(workspace, plan.kind === "paid" ? plan.entryId : null, { targetId: gstin }));
    const charged = !cached && plan.kind === "paid" ? cost : 0;
    return res.json({ gstin: record, cached, stale: Boolean(stale), charged, ...(plan.kind === "free" && plan.counted && !cached ? { freeLeft: plan.freeLeft } : {}) });
  } catch (error) {
    await undo("Verification failed: refunded").catch(() => undefined);
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
