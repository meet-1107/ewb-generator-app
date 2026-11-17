import { Router, type IRouter } from "express";
import { z } from "zod";
import { directory } from "../lib/admin-directory";
import { rateLimit } from "../lib/rate-limit";
import { peekWorkspace } from "../lib/store";
import { addUserMessage, markSeenByUser, readThread, TOPIC_LABELS, type SupportThread } from "../lib/support";

/** The app's support chat: the thread, and sending a message (answered at once by the assistant). */
const router: IRouter = Router();

const view = (thread: SupportThread | null) => ({
  messages: (thread?.messages ?? []).map(({ adminEmail: _adminEmail, ...item }) => item),
  status: thread?.status ?? null,
  unread: thread?.unreadForUser ?? 0,
  topics: Object.entries(TOPIC_LABELS).map(([value, label]) => ({ value, label })),
});

router.get("/support", async (req, res) => {
  const thread = req.query["seen"] === "1" ? await markSeenByUser(req.workspaceId) : await readThread(req.workspaceId);
  res.json(view(thread));
});

const messageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  topic: z.enum(["ewb_login", "payment", "credits", "ewb_generate", "other"]).optional(),
});

router.post("/support/messages", rateLimit({ windowMs: 60_000, max: 12, by: "workspace" }), async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", message: "Write your question (up to 2000 characters)." });
  const [user, workspace] = await Promise.all([
    directory().get(req.workspaceId).catch(() => null),
    peekWorkspace(req.workspaceId, { syncKeys: ["business/profile"] }).catch(() => null),
  ]);
  const business = workspace?.sync["business"]?.["profile"]?.data as { name?: string; gstin?: string } | undefined;
  const thread = await addUserMessage({ uid: req.workspaceId, email: user?.email ?? null, name: user?.name ?? null, businessName: business?.name ?? null, gstin: business?.gstin ?? null }, parsed.data.text, parsed.data.topic);
  return res.status(201).json(view(thread));
});

export default router;
