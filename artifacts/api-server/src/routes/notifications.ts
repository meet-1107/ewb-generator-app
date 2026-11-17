import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { withDoc, withWorkspace } from "../lib/store";
import { noticeList, saveToken } from "../lib/notify";

/** The bell: the newest notifications, marking them read, and this phone's push token. */
const router: IRouter = Router();

router.get("/notifications", async (req, res) => {
  res.json(await withWorkspace(req.workspaceId, (workspace) => noticeList(workspace)));
});

/** `ids`: those notifications, or every one when left out. */
router.post("/notifications/read", async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().max(80)).max(50).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Could not read the notifications to mark." });
  const ids = parsed.data.ids ? new Set(parsed.data.ids) : null;
  return res.json(await withWorkspace(req.workspaceId, (workspace) => {
    for (const notice of workspace.notices ?? []) if (!ids || ids.has(notice.id)) notice.read = true;
    return noticeList(workspace);
  }));
});

/** Deletes `ids`, or every notification when left out (swipe, or Select all → Delete). */
router.post("/notifications/delete", async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().max(80)).max(50).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Could not read the notifications to delete." });
  const ids = parsed.data.ids ? new Set(parsed.data.ids) : null;
  return res.json(await withWorkspace(req.workspaceId, (workspace) => {
    workspace.notices = ids ? (workspace.notices ?? []).filter((notice) => !ids.has(notice.id)) : [];
    return noticeList(workspace);
  }));
});

const tokenSchema = z.object({ token: z.string().min(20).max(4096), platform: z.enum(["android", "ios", "web"]).default("android") });

router.post("/push-token", async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Could not read the device token." });
  const { token, platform } = parsed.data;
  await withWorkspace(req.workspaceId, (workspace) => saveToken(workspace, token, platform));
  // One phone, one account: if this phone was signed in to another account before (and
  // its sign-out did not reach us), that account stops sending notifications to it.
  const id = createHash("sha256").update(token).digest("hex");
  const previous = await withDoc<{ uid: string; at: string }, string | null>("push_tokens", id, (current) => ({ next: { uid: req.workspaceId, at: new Date().toISOString() }, result: current && current.uid !== req.workspaceId ? current.uid : null }));
  if (previous) await withWorkspace(previous, (workspace) => { delete workspace.pushTokens?.[token]; }).catch(() => undefined);
  return res.json({ ok: true });
});

/** Sign-out: this phone stops getting this account's notifications. */
router.post("/push-token/remove", async (req, res) => {
  const token = z.string().max(4096).safeParse(req.body?.token);
  if (!token.success) return res.status(400).json({ error: "bad_request", message: "Could not read the device token." });
  await withWorkspace(req.workspaceId, (workspace) => { delete workspace.pushTokens?.[token.data]; });
  return res.json({ ok: true });
});


export default router;
