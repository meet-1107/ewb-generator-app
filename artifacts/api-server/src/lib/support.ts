import { randomUUID } from "node:crypto";
import { listDocs, readDoc, withDoc } from "./store";

/**
 * Support chat: one thread per account (collection "support_threads", id = uid).
 * Every message the user sends is answered at once by a rule-based assistant and
 * kept for the support team, who reply from the admin panel (Support).
 */

export type SupportTopic = "ewb_login" | "payment" | "credits" | "ewb_generate" | "other";

export const TOPIC_LABELS: Record<SupportTopic, string> = {
  ewb_login: "E-way bill portal login",
  payment: "Payment",
  credits: "Credits",
  ewb_generate: "Generating an e-way bill",
  other: "Other",
};

/** `guide`: the app shows the step-by-step pictures under this message. */
export type SupportMessage = { id: string; at: string; from: "user" | "bot" | "admin"; text: string; adminEmail?: string; guide?: "ewb_login" };

export type SupportThread = {
  uid: string;
  email: string | null;
  name: string | null;
  businessName: string | null;
  gstin: string | null;
  topic: SupportTopic;
  /** open: waiting for the team · replied: the team answered last · closed: resolved. */
  status: "open" | "replied" | "closed";
  messages: SupportMessage[];
  createdAt: string;
  updatedAt: string;
  lastUserAt: string;
  /** Admin replies the user has not seen yet. */
  unreadForUser: number;
};

const MESSAGES_KEPT = 300;
export const OFF_TOPIC_REPLY = "• Thank you for your message.\n• Our team will review your concern within 24 hours.";
export const TEAM_PROMISE = "• Our support team will also reply here within 24 hours.";

const RULES: { topic: SupportTopic; words: RegExp; reply: string }[] = [
  {
    topic: "ewb_login",
    words: /(credential|username|user ?name|password|login|log in|api user|portal|ewb ?login|nic|sign ?in to portal|invalid user|gsp)/i,
    reply: "E-way bill portal API login\n• It is different from your normal portal login.\n• Create it once on ewaybillgst.gov.in → Registration → For GSP.\n• GSP name: Chartered Information Systems Private Limited.\n• Follow the pictures below, step by step.\n• Then save the API username and password in the app.\n• \"Invalid username or password\"? Create a new API user and save it again.",
  },
  {
    topic: "payment",
    words: /(payment|paid|pay |razorpay|upi|money|deduct|debited|refund|transaction|amount|bank|failed payment)/i,
    reply: "Payment\n• Money debited but no credits? Open Wallet and pull down to refresh.\n• The app checks the payment again and adds the credits by itself.\n• An unfinished payment is not charged. Your bank returns any held amount in 5–7 working days.",
  },
  {
    topic: "credits",
    words: /(credit|balance|wallet|top ?up|recharge|welcome|free)/i,
    reply: "Credits\n• Generate, Part-B, extend, cancel and consolidate each use credits.\n• Credits are used only when the portal accepts the request.\n• If a request fails, the credits come back automatically.\n• Buy more from Wallet → Add credits.",
  },
  {
    topic: "ewb_generate",
    words: /(generat|e-?way|ewb|eway|reject|error|not working|issue|problem|vehicle|distance|pin ?code|hsn|part ?b|cancel|extend)/i,
    reply: "E-way bill not generating\n• Check the PIN codes and the distance.\n• Add the vehicle number for road transport.\n• HSN code must be 4–8 digits.\n• Use a new invoice number (each bill needs its own).\n• Check that your portal login is still valid.\n• Read the error on the review screen, fix it and generate again. A failed attempt uses no credits.",
  },
];

/** What the assistant answers, and the topic it read from the message. */
export function botReply(text: string, chosen?: SupportTopic): { topic: SupportTopic; text: string; guide?: "ewb_login" } {
  // "Something else" goes straight to the team.
  if (chosen === "other") return { topic: "other", text: OFF_TOPIC_REPLY };
  const rule = (chosen ? RULES.find((item) => item.topic === chosen) : undefined) ?? RULES.find((item) => item.words.test(text));
  // Not about the app (or no topic it knows): one short line, the team takes it from there.
  if (!rule) return { topic: chosen ?? "other", text: OFF_TOPIC_REPLY };
  return { topic: rule.topic, text: `${rule.reply}\n\n${TEAM_PROMISE}`, ...(rule.topic === "ewb_login" ? { guide: "ewb_login" as const } : {}) };
}

const message = (from: SupportMessage["from"], text: string, adminEmail?: string, guide?: SupportMessage["guide"]): SupportMessage => ({ id: randomUUID(), at: new Date().toISOString(), from, text, ...(adminEmail ? { adminEmail } : {}), ...(guide ? { guide } : {}) });

/** A thread is one Firestore document (1 MiB at most): kept well under it, oldest messages first out. */
const MAX_THREAD_BYTES = 600_000;

const trim = (thread: SupportThread) => {
  if (thread.messages.length > MESSAGES_KEPT) thread.messages.splice(0, thread.messages.length - MESSAGES_KEPT);
  // Indian scripts take 3 bytes a character, so a count alone is not enough.
  while (thread.messages.length > 2 && Buffer.byteLength(JSON.stringify(thread), "utf8") > MAX_THREAD_BYTES) thread.messages.shift();
  return thread;
};

export type Who = { uid: string; email: string | null; name: string | null; businessName: string | null; gstin: string | null };

/** The user's message and the assistant's answer, added to their thread (opened again if closed). */
export function addUserMessage(who: Who, text: string, topic?: SupportTopic) {
  return withDoc<SupportThread, SupportThread>("support_threads", who.uid, (current) => {
    const now = new Date().toISOString();
    const answer = botReply(text, topic);
    const thread: SupportThread = current ?? { ...who, topic: answer.topic, status: "open", messages: [], createdAt: now, updatedAt: now, lastUserAt: now, unreadForUser: 0 };
    Object.assign(thread, { email: who.email ?? thread.email, name: who.name ?? thread.name, businessName: who.businessName ?? thread.businessName, gstin: who.gstin ?? thread.gstin });
    if (answer.topic !== "other" || thread.status === "closed") thread.topic = answer.topic;
    thread.messages.push(message("user", text), message("bot", answer.text, undefined, answer.guide));
    thread.status = "open";
    thread.updatedAt = now;
    thread.lastUserAt = now;
    return { next: trim(thread), result: thread };
  });
}

/** Messages the team may send one user per day (India time), replies and new messages together. */
export const ADMIN_MESSAGES_PER_DAY = 10;

const istDay = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Team messages sent to this thread today (India time). */
export function adminMessagesToday(thread: SupportThread | null, now = new Date().toISOString()) {
  const today = istDay(now);
  return (thread?.messages ?? []).filter((item) => item.from === "admin" && istDay(item.at) === today).length;
}

export type AdminSend = { ok: true; thread: SupportThread } | { ok: false; reason: "limit"; sentToday: number };

/**
 * A reply, or a first message to a user who never wrote (`who` opens the thread).
 * At most ADMIN_MESSAGES_PER_DAY per user per day.
 */
export function addAdminReply(uid: string, text: string, adminEmail: string, who?: Who) {
  return withDoc<SupportThread, AdminSend | null>("support_threads", uid, (current) => {
    if (!current && !who) return { next: null, result: null };
    const now = new Date().toISOString();
    const sentToday = adminMessagesToday(current, now);
    if (sentToday >= ADMIN_MESSAGES_PER_DAY) return { next: current, result: { ok: false, reason: "limit", sentToday } };
    const thread: SupportThread = current ?? { ...who!, topic: "other", status: "replied", messages: [], createdAt: now, updatedAt: now, lastUserAt: now, unreadForUser: 0 };
    thread.messages.push(message("admin", text, adminEmail));
    thread.status = "replied";
    thread.updatedAt = now;
    thread.unreadForUser += 1;
    return { next: trim(thread), result: { ok: true, thread } };
  });
}

export function setThreadStatus(uid: string, status: SupportThread["status"]) {
  return withDoc<SupportThread, SupportThread | null>("support_threads", uid, (current) => {
    if (!current) return { next: null, result: null };
    current.status = status;
    current.updatedAt = new Date().toISOString();
    return { next: current, result: current };
  });
}

/** The user opened the chat: the team's replies are seen. */
export function markSeenByUser(uid: string) {
  return withDoc<SupportThread, SupportThread | null>("support_threads", uid, (current) => {
    if (!current || !current.unreadForUser) return { next: current, result: current };
    current.unreadForUser = 0;
    return { next: current, result: current };
  });
}

export const readThread = (uid: string) => readDoc<SupportThread>("support_threads", uid);
export const listThreads = () => listDocs<SupportThread>("support_threads");
