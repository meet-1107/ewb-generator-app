import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { authMode } from "../lib/auth";
import { audit, withWorkspace } from "../lib/store";
import { addCredits, walletSummary } from "../lib/wallet";

/** Signed-in wallet routes (mounted after requireWorkspace). */
export const walletRouter: IRouter = Router();

walletRouter.get("/wallet", async (req, res) => {
  res.json(await withWorkspace(req.workspaceId, (workspace) => walletSummary(workspace)));
});

// Preview / sandbox workspaces only: lets testers refill without an admin.
walletRouter.post("/wallet/test-credits", async (req, res) => {
  if (authMode !== "sandbox") return res.status(403).json({ error: "forbidden", message: "Credits are added by the app owner." });
  return res.json(await withWorkspace(req.workspaceId, (workspace) => {
    addCredits(workspace, 100, "Test credits (sandbox)");
    return walletSummary(workspace);
  }));
});

/**
 * Owner-only top-up: POST /api/admin/wallet/topup with header
 * `x-admin-token: <WALLET_ADMIN_TOKEN>` and { workspaceId, credits, note }.
 * The workspace ID of a signed-in user is their Firebase UID.
 */
export const adminRouter: IRouter = Router();
const adminToken = process.env["WALLET_ADMIN_TOKEN"] ?? "";

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
