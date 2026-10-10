import { Router, type IRouter } from "express";
import { gstProvider } from "../providers/gst-provider";
import { withWorkspace } from "../lib/store";
import { gstinProblem } from "../lib/validation";

const router: IRouter = Router();
const REFRESH_COOLDOWN_MS = 60_000;

function periodOk(period: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

router.get("/gst/status", async (req, res) => {
  const gstin = String(req.query["gstin"] ?? "").toUpperCase();
  const period = String(req.query["period"] ?? "");
  if (gstinProblem(gstin) || !periodOk(period)) return res.status(400).json({ error: "bad_request", message: "Choose a valid GSTIN and period." });
  const snapshots = await withWorkspace(req.workspaceId, (workspace) =>
    Object.values(workspace.gst).filter((item) => item.gstin === gstin && item.period === period),
  { gst: "all" });
  return res.json({
    snapshots,
    provider: gstProvider ? { id: gstProvider.id, label: gstProvider.label, sandbox: gstProvider.sandbox } : null,
  });
});

router.post("/gst/refresh", async (req, res) => {
  if (!gstProvider) return res.status(503).json({ error: "provider_not_configured", message: "GST status provider not configured." });
  const gstin = String(req.body?.gstin ?? "").toUpperCase();
  const period = String(req.body?.period ?? "");
  if (gstinProblem(gstin) || !periodOk(period)) return res.status(400).json({ error: "bad_request", message: "Choose a valid GSTIN and period." });
  const key = `${gstin}:${period}`;
  const last = await withWorkspace(req.workspaceId, (workspace) => workspace.gstLastSyncAt[key]);
  if (last && Date.now() - Date.parse(last) < REFRESH_COOLDOWN_MS) {
    return res.status(429).json({ error: "rate_limited", message: "Status was checked less than a minute ago. Try again shortly." });
  }
  const fetched = await gstProvider.fetchStatus(gstin, period);
  const checkedAt = new Date().toISOString();
  const snapshots = await withWorkspace(req.workspaceId, (workspace) => {
    workspace.gstLastSyncAt[key] = checkedAt;
    return fetched.map((item) => {
      const id = `${item.gstin}:${item.returnType}:${item.period}`;
      workspace.gst[id] = { ...item, id, checkedAt };
      return workspace.gst[id]!;
    });
  }, { gst: [] });
  return res.json({ snapshots, provider: { id: gstProvider.id, label: gstProvider.label, sandbox: gstProvider.sandbox } });
});

export default router;
