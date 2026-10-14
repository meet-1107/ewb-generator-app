import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { authMode } from "../lib/auth";
import { logger } from "../lib/logger";
import { createPaymentLink, creditPacks, creditPricePaise, fetchPaymentLink, MAX_PURCHASE, MIN_PURCHASE, razorpayConfigured, webhookSignatureValid } from "../lib/payments";
import { appendLog, audit, withWorkspace, type Workspace } from "../lib/store";
import { addCredits, walletHistory, walletSummary } from "../lib/wallet";

const paymentsMode = razorpayConfigured ? "razorpay" : authMode === "sandbox" ? "sandbox" : "off";

function pricing() {
  return { creditPricePaise, packs: creditPacks, min: MIN_PURCHASE, max: MAX_PURCHASE, payments: paymentsMode };
}

/** Marks a purchase paid and adds its credits exactly once. */
export function settlePurchase(workspace: Workspace, purchaseId: string, paymentId?: string) {
  const purchase = workspace.purchases[purchaseId];
  if (!purchase || purchase.status === "paid") return false;
  purchase.status = "paid";
  purchase.paidAt = new Date().toISOString();
  purchase.paymentId = paymentId;
  addCredits(workspace, purchase.credits, `Bought for ₹${(purchase.amountPaise / 100).toFixed(2)}${paymentId ? ` · ${paymentId}` : purchase.provider === "sandbox" ? " · test purchase" : ""}`, purchaseId);
  audit(workspace, "payments", "wallet.purchase", purchaseId, "paid");
  return true;
}

/** Signed-in wallet routes (mounted after requireWorkspace). */
export const walletRouter: IRouter = Router();

walletRouter.get("/wallet", async (req, res) => {
  res.json({ ...(await withWorkspace(req.workspaceId, (workspace) => walletSummary(workspace))), pricing: pricing() });
});

walletRouter.get("/wallet/history", async (req, res) => {
  const month = typeof req.query["month"] === "string" ? req.query["month"] : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: "bad_request", message: "Choose a month as YYYY-MM." });
  return res.json(await withWorkspace(req.workspaceId, (workspace) => walletHistory(workspace, month)));
});

walletRouter.post("/wallet/purchase", async (req, res) => {
  const parsed = z.object({ credits: z.number().int().min(MIN_PURCHASE).max(MAX_PURCHASE) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: `Choose between ${MIN_PURCHASE} and ${MAX_PURCHASE} credits.` });
  const credits = parsed.data.credits;
  const amountPaise = credits * creditPricePaise;
  if (paymentsMode === "off") return res.status(503).json({ error: "payments_off", message: "Online payment is not set up yet. Use “Request credits” instead." });

  if (paymentsMode === "sandbox") {
    const result = await withWorkspace(req.workspaceId, (workspace) => {
      const id = `sbx_${Date.now().toString(36)}`;
      workspace.purchases[id] = { id, provider: "sandbox", credits, amountPaise, status: "created", createdAt: new Date().toISOString() };
      settlePurchase(workspace, id);
      return { purchase: workspace.purchases[id], balance: workspace.wallet.balance };
    });
    return res.status(201).json(result);
  }

  let link: { id: string; shortUrl: string };
  try {
    link = await createPaymentLink({ workspaceId: req.workspaceId, credits, amountPaise });
  } catch (error) {
    req.log?.error({ err: (error as Error).message }, "Razorpay link failed");
    return res.status(502).json({ error: "payment_unavailable", message: "Could not start the payment. Try again in a moment." });
  }
  const purchase = await withWorkspace(req.workspaceId, (workspace) => {
    workspace.purchases[link.id] = { id: link.id, provider: "razorpay", credits, amountPaise, status: "created", shortUrl: link.shortUrl, createdAt: new Date().toISOString() };
    return workspace.purchases[link.id];
  });
  return res.status(201).json({ purchase });
});

/** Re-checks a pending purchase with Razorpay (used when the user returns from the payment page). */
walletRouter.get("/wallet/purchase/:id", async (req, res) => {
  const current = await withWorkspace(req.workspaceId, (workspace) => structuredClone(workspace.purchases[req.params.id] ?? null));
  if (!current) return res.status(404).json({ error: "not_found", message: "Purchase not found." });
  if (current.status === "created" && current.provider === "razorpay") {
    try {
      const link = await fetchPaymentLink(current.id);
      if (link.status === "paid" && link.amountPaid >= current.amountPaise) {
        await withWorkspace(req.workspaceId, (workspace) => settlePurchase(workspace, current.id, link.paymentId));
      } else if (link.status !== "created") {
        await withWorkspace(req.workspaceId, (workspace) => { workspace.purchases[current.id]!.status = link.status; });
      }
    } catch (error) {
      req.log?.warn({ err: (error as Error).message }, "Razorpay status check failed");
    }
  }
  return res.json(await withWorkspace(req.workspaceId, (workspace) => ({ purchase: workspace.purchases[req.params.id], balance: workspace.wallet.balance })));
});

/** Public routes (mounted before requireWorkspace). */
export const adminRouter: IRouter = Router();
const adminToken = process.env["WALLET_ADMIN_TOKEN"] ?? "";

/**
 * Owner-only top-up: POST /api/admin/wallet/topup with header
 * `x-admin-token: <WALLET_ADMIN_TOKEN>` and { workspaceId, credits, note }.
 * The workspace ID of a signed-in user is their Firebase UID.
 */
adminRouter.post("/admin/wallet/topup", async (req, res) => {
  const given = Buffer.from(req.header("x-admin-token") ?? "");
  const expected = Buffer.from(adminToken);
  if (adminToken.length < 16 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: "unauthorized", message: "Admin token required." });
  }
  const parsed = z.object({ workspaceId: z.string().regex(/^[A-Za-z0-9_-]{6,80}$/), credits: z.number().int().min(1).max(1_000_000), note: z.string().max(120).default("Credits added") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Send workspaceId, credits (whole number) and an optional note." });
  const { workspaceId, credits, note } = parsed.data;
  const summary = await withWorkspace(workspaceId, (workspace) => {
    addCredits(workspace, credits, note);
    audit(workspace, "admin", "wallet.topup", String(credits), "ok");
    return walletSummary(workspace);
  });
  return res.json({ workspaceId, balance: summary.balance });
});

/**
 * Razorpay webhook (Dashboard → Webhooks → URL https://<server>/api/payments/razorpay/webhook,
 * event payment_link.paid, secret = RAZORPAY_WEBHOOK_SECRET).
 */
adminRouter.post("/payments/razorpay/webhook", async (req, res) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!webhookSignatureValid(raw, req.header("x-razorpay-signature"))) {
    await appendLog("payment_events", { at: new Date().toISOString(), provider: "razorpay", event: "invalid_signature", signatureValid: false }).catch(() => undefined);
    return res.status(401).json({ error: "bad_signature" });
  }
  const event = req.body as { event?: string; payload?: { payment_link?: { entity?: { id?: string; amount_paid?: number; notes?: Record<string, string> } }; payment?: { entity?: { id?: string } } } };
  if (event.event !== "payment_link.paid") return res.json({ ok: true, ignored: event.event });
  const link = event.payload?.payment_link?.entity;
  const workspaceId = link?.notes?.["workspace_id"];
  if (!link?.id || !workspaceId || !/^[A-Za-z0-9_-]{6,80}$/.test(workspaceId)) return res.json({ ok: true, ignored: "no workspace" });
  const credited = await withWorkspace(workspaceId, (workspace) => {
    const purchase = workspace.purchases[link.id!];
    // Trust our own record for the amount, never the webhook's notes.
    if (!purchase || (link.amount_paid ?? 0) < purchase.amountPaise) return false;
    return settlePurchase(workspace, link.id!, event.payload?.payment?.entity?.id);
  });
  logger.info({ link: link.id, credited }, "Razorpay payment_link.paid");
  // Every verified delivery is kept, so replays and late deliveries are visible in the admin panel.
  await appendLog("payment_events", { at: new Date().toISOString(), provider: "razorpay", event: event.event, signatureValid: true, linkId: link.id, paymentId: event.payload?.payment?.entity?.id ?? null, workspaceId, amountPaid: link.amount_paid ?? 0, credited }).catch(() => undefined);
  return res.json({ ok: true });
});
