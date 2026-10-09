import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { audit, currentPeriod, withWorkspace } from "../lib/store";
import { billingMode, planById, plans, plansAreSamples } from "../lib/plans";
import { ewbProvider } from "../providers/ewb-provider";
import { gstProvider } from "../providers/gst-provider";
import { authMode } from "../lib/auth";

const router: IRouter = Router();

router.get("/config", (_req, res) => {
  res.json({
    authMode,
    ewbProvider: ewbProvider ? { id: ewbProvider.id, label: ewbProvider.label, sandbox: ewbProvider.sandbox } : null,
    gstProvider: gstProvider ? { id: gstProvider.id, label: gstProvider.label, sandbox: gstProvider.sandbox } : null,
    billingMode,
    pdfParser: "heuristic-1",
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
    return res.status(501).json({ error: "billing_store", message: "Purchases are completed through the app store billing sheet." });
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
        if (!existing || existing.updatedAt < record.updatedAt) target[record.id] = record;
      }
    }
    const out: Record<string, unknown[]> = {};
    for (const [name, records] of Object.entries(workspace.sync)) {
      out[name] = Object.values(records).filter((record) => !since || record.updatedAt > since);
    }
    return out;
  });
  return res.json({ serverTime, changes });
});

router.get("/audit", async (req, res) => {
  const events = await withWorkspace(req.workspaceId, (workspace) => workspace.audit.slice(-100).reverse());
  res.json({ events });
});

export default router;
