import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { appendLog, audit, currentPeriod, withWorkspace } from "../lib/store";
import { rateLimit } from "../lib/rate-limit";
import { billingMode, planById, plans, plansAreSamples } from "../lib/plans";
import { ewbProvider } from "../providers/ewb-provider";
import { gstProvider } from "../providers/gst-provider";
import { authMode } from "../lib/auth";
import { gstinApiConfigured } from "../lib/gstinapi";
import { mailer } from "../lib/mailer";
import { creditCosts } from "../lib/wallet";
import { distanceConfigured } from "../lib/distance";
import { consentOf, LEGAL_VERSION, recordConsent } from "../lib/legal";

const router: IRouter = Router();

/** Whether this account accepted the current Terms & Privacy Policy. */
router.get("/consent", async (req, res) => {
  const accepted = await consentOf(req.workspaceId);
  res.json({ version: LEGAL_VERSION, accepted: accepted ? { version: accepted.version, acceptedAt: accepted.acceptedAt } : null, required: accepted?.version !== LEGAL_VERSION });
});

/** Records acceptance of the current version (the checkbox at sign-up, or the prompt after sign-in). */
router.post("/consent", async (req, res) => {
  const parsed = z.object({ version: z.string().max(40), method: z.enum(["signup", "google", "prompt"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Consent could not be read." });
  if (parsed.data.version !== LEGAL_VERSION) return res.status(409).json({ error: "outdated", message: "The Terms or Privacy Policy changed. Please read and accept the latest version.", version: LEGAL_VERSION });
  const record = await recordConsent(req.workspaceId, { method: parsed.data.method, ip: String(req.ip ?? "").slice(0, 64), userAgent: String(req.header("user-agent") ?? "").slice(0, 200) });
  return res.json({ version: record.version, acceptedAt: record.acceptedAt });
});

router.get("/config", (_req, res) => {
  res.json({
    authMode,
    ewbProvider: ewbProvider ? { id: ewbProvider.id, label: ewbProvider.label, sandbox: ewbProvider.sandbox } : null,
    gstProvider: gstProvider ? { id: gstProvider.id, label: gstProvider.label, sandbox: gstProvider.sandbox } : null,
    billingMode,
    pdfParser: "heuristic-1",
    gstinVerification: gstinApiConfigured,
    emailOtp: authMode === "firebase" && (process.env["OTP_PEPPER"] ?? "").length >= 16 && mailer.configured,
    ewbCredentialsRequired: Boolean(ewbProvider?.needsCredentials),
    creditCosts,
    distanceLookup: distanceConfigured,
    // Link for "Video tutorial" in Help & data (e.g. a YouTube video or playlist); changed without an app update.
    tutorialVideoUrl: /^https:\/\/\S+$/.test(process.env["TUTORIAL_VIDEO_URL"]?.trim() ?? "") ? process.env["TUTORIAL_VIDEO_URL"]!.trim() : null,
  });
});

router.get("/subscription", async (req, res) => {
  const subscription = await withWorkspace(req.workspaceId, (workspace) => {
    const period = currentPeriod();
    if (workspace.subscription.usagePeriod !== period) {
      workspace.subscription.usagePeriod = period;
      workspace.subscription.usageCount = 0;
    }
    if (workspace.subscription.entitlementState === "trial" && Date.parse(workspace.subscription.renewalAt) < Date.now()) {
      workspace.subscription.entitlementState = "active";
      workspace.subscription.planId = "free";
    }
    return workspace.subscription;
  });
  res.json({ subscription, plan: planById(subscription.planId), plans, plansAreSamples, billingMode });
});

router.post("/subscription/change", async (req, res) => {
  const planId = z.string().safeParse(req.body?.planId);
  if (!planId.success || !plans.some((plan) => plan.id === planId.data)) return res.status(400).json({ error: "bad_request", message: "Choose a plan." });
  if (billingMode !== "sandbox") {
    return res.status(501).json({ error: "billing_off", message: "Plans cannot be bought yet. E-way bills are paid with wallet credits." });
  }
  const subscription = await withWorkspace(req.workspaceId, (workspace) => {
    const plan = planById(planId.data);
    const now = new Date();
    workspace.subscription.planId = plan.id;
    workspace.subscription.entitlementState = "active";
    workspace.subscription.renewalAt = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    workspace.subscription.updatedAt = now.toISOString();
    workspace.subscription.billingHistory.unshift({ at: now.toISOString(), planId: plan.id, amountPaise: 0, reference: `SANDBOX-${randomUUID().slice(0, 8).toUpperCase()}` });
    audit(workspace, req.actor, "subscription.change", plan.id, "sandbox");
    return workspace.subscription;
  });
  return res.json({ subscription, plan: planById(subscription.planId) });
});

/**
 * Last-write-wins sync for user-owned records (invoices, saved parties,
 * products, transporters, business profile). The client sends records that
 * changed since `since`; the server returns everything newer.
 */
const syncSchema = z.object({
  since: z.string().optional(),
  collections: z.record(z.string().regex(/^[a-z]{3,20}$/), z.array(z.object({
    id: z.string().min(1).max(100),
    updatedAt: z.string().max(40),
    deleted: z.boolean().optional(),
    data: z.unknown().default(null),
  })).max(2000)),
});

router.post("/sync", async (req, res) => {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Sync payload could not be read." });
  if (JSON.stringify(req.body).length > 5_000_000) return res.status(413).json({ error: "too_large", message: "Too much data in one sync." });
  const { since, collections } = parsed.data;
  const serverTime = new Date().toISOString();
  const changes = await withWorkspace(req.workspaceId, (workspace) => {
    for (const [name, records] of Object.entries(collections)) {
      const target = (workspace.sync[name] ??= {});
      for (const record of records) {
        const existing = target[record.id];
        if (!existing || existing.updatedAt < record.updatedAt) target[record.id] = { ...record, receivedAt: serverTime };
      }
    }
    const out: Record<string, unknown[]> = {};
    for (const [name, records] of Object.entries(workspace.sync)) {
      // By arrival time: a change made offline yesterday but uploaded now is still new to other devices.
      out[name] = Object.values(records).filter((record) => !since || (record.receivedAt ?? record.updatedAt) > since);
    }
    return out;
  }, { sync: since ? { since, keys: Object.entries(collections).flatMap(([name, records]) => records.map((record) => `${name}/${record.id}`)) } : "all" });
  return res.json({ serverTime, changes });
});

/**
 * The app was opened (started, or brought back after a while). One record per open in
 * the `app_opens` log, for daily active users and opens per day in the admin panel.
 * Holds no business data: only who, when and which app build.
 */
router.post("/activity/open", rateLimit({ windowMs: 60_000, max: 6, by: "workspace" }), async (req, res) => {
  const parsed = z.object({ platform: z.enum(["android", "ios", "web"]), appVersion: z.string().max(20) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Activity could not be read." });
  await appendLog("app_opens", { at: new Date().toISOString(), workspaceId: req.workspaceId, platform: parsed.data.platform, appVersion: parsed.data.appVersion });
  return res.status(204).end();
});

/** Steps of buying credits in the app, for the admin panel: who opened checkout, reached the payment page, came back without paying, or paid. */
export const PAYMENT_STEPS = ["wallet_opened", "checkout_opened", "checkout_closed", "payment_page_opened", "returned_paid", "returned_unpaid", "payment_error"] as const;

router.post("/activity/payment", rateLimit({ windowMs: 60_000, max: 30, by: "workspace" }), async (req, res) => {
  const parsed = z.object({
    step: z.enum(PAYMENT_STEPS),
    credits: z.number().int().min(0).max(1_000_000).optional(),
    purchaseId: z.string().max(80).optional(),
    note: z.string().max(200).optional(),
    appVersion: z.string().max(20).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Payment step could not be read." });
  const { step, credits, purchaseId, note, appVersion } = parsed.data;
  await appendLog("payment_steps", { at: new Date().toISOString(), workspaceId: req.workspaceId, step, ...(credits !== undefined ? { credits } : {}), ...(purchaseId ? { purchaseId } : {}), ...(note ? { note } : {}), ...(appVersion ? { appVersion } : {}) });
  return res.status(204).end();
});

router.get("/audit", async (req, res) => {
  const events = await withWorkspace(req.workspaceId, (workspace) => workspace.audit.slice(-100).reverse());
  res.json({ events });
});

export default router;
