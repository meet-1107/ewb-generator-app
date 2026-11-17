import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { withWorkspace, type Notice, type Workspace } from "./store";

/**
 * Notifications: credits bought or added, payments that did not go through, and
 * e-way bills generated. Each one is saved on the workspace (the bell shows the
 * newest) inside the same transaction as the event, then `pushNotices` sends the
 * unsent ones to the user's phones with Firebase Cloud Messaging.
 */

/** Notifications kept per account (the bell shows the newest NOTICES_SHOWN). */
const NOTICES_KEPT = 30;
export const NOTICES_SHOWN = 10;
/** Devices kept per account; the least recently seen are dropped first. */
const TOKENS_KEPT = 10;

/** Saves a notification. Call inside `withWorkspace`; send it afterwards with `pushNotices`. */
export function addNotice(workspace: Workspace, notice: Omit<Notice, "id" | "at" | "read" | "pushed">): Notice {
  const record: Notice = { id: randomUUID(), at: new Date().toISOString(), ...notice };
  const list = (workspace.notices ??= []);
  list.push(record);
  if (list.length > NOTICES_KEPT) list.splice(0, list.length - NOTICES_KEPT);
  return record;
}

const credits = (n: number) => `${n.toLocaleString("en-IN")} credit${Math.abs(n) === 1 ? "" : "s"}`;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function noticeCreditsBought(workspace: Workspace, amountPaise: number, added: number) {
  return addNotice(workspace, { kind: "credits", route: "wallet", title: `Payment received · ${rupees(amountPaise)}`, body: `${credits(added)} added to your wallet. Balance: ${credits(workspace.wallet.balance)}.` });
}

export function noticeCreditsChanged(workspace: Workspace, change: number, note?: string) {
  return addNotice(workspace, {
    kind: "credits",
    route: "wallet",
    title: change > 0 ? `${credits(change)} added` : `${credits(-change)} removed`,
    body: `${note ? `${note}. ` : ""}Balance: ${credits(workspace.wallet.balance)}.`,
  });
}

export function noticePaymentFailed(workspace: Workspace, amountPaise: number, status: string) {
  return addNotice(workspace, { kind: "payment", route: "wallet", title: "Payment not completed", body: `Your payment of ${rupees(amountPaise)} was ${status === "expired" ? "not finished in time" : "cancelled"}. No money was taken for credits. Tap to try again.` });
}

export function noticeEwbGenerated(workspace: Workspace, ewb: { id: string; ewbNumber: string; invoiceNumber: string; buyerName: string; validUntil: string }) {
  const until = new Date(ewb.validUntil).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
  return addNotice(workspace, { kind: "ewb", route: "ewb", targetId: ewb.id, title: `E-way bill ${ewb.ewbNumber} generated`, body: `Invoice ${ewb.invoiceNumber} · ${ewb.buyerName}. Valid till ${until}.` });
}

export function noticeSupportReply(workspace: Workspace, text: string) {
  return addNotice(workspace, { kind: "support", route: "support", title: "E-Way Easy support replied", body: text.length > 140 ? `${text.slice(0, 137)}…` : text });
}

export function saveToken(workspace: Workspace, token: string, platform: string) {
  const tokens = (workspace.pushTokens ??= {});
  tokens[token] = { platform, updatedAt: new Date().toISOString() };
  const stale = Object.entries(tokens).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt)).slice(TOKENS_KEPT);
  for (const [old] of stale) delete tokens[old];
}

/** Newest first, as the app shows them. */
export function noticeList(workspace: Workspace) {
  const list = [...(workspace.notices ?? [])].reverse();
  return {
    notices: list.slice(0, NOTICES_SHOWN).map(({ pushed: _pushed, ...notice }) => ({ ...notice, read: Boolean(notice.read) })),
    unread: list.slice(0, NOTICES_SHOWN).filter((notice) => !notice.read).length,
  };
}

type Sender = (tokens: string[], notice: Notice, badge: number) => Promise<{ invalid: string[] }>;

/** FCM through the Firebase Admin SDK; only on Firestore (Cloud Functions), never in local tests. */
const fcmSender: Sender = async (tokens, notice, badge) => {
  const [{ getMessaging }, { firebaseApp }] = await Promise.all([import("firebase-admin/messaging"), import("./firebase")]);
  const response = await getMessaging(firebaseApp()).sendEachForMulticast({
    tokens,
    notification: { title: notice.title, body: notice.body },
    data: { noticeId: notice.id, route: notice.route, targetId: notice.targetId ?? "", kind: notice.kind },
    android: { priority: "high", notification: { channelId: "updates", color: "#175B42", tag: notice.id, notificationCount: badge, defaultSound: true } },
    apns: { payload: { aps: { badge, sound: "default" } } },
  });
  const invalid: string[] = [];
  response.responses.forEach((item, index) => {
    const code = item.error?.code ?? "";
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token" || code === "messaging/invalid-argument") invalid.push(tokens[index]!);
  });
  return { invalid };
};

let sender: Sender | null = process.env["STORE"] === "firestore" ? fcmSender : null;

/** Tests swap the sender (null turns pushing off). */
export function setPushSender(next: Sender | null) {
  sender = next;
}

/**
 * Sends the notifications not sent yet to every device of the account and drops
 * tokens FCM no longer knows. Never throws: a failed push leaves the notice under the bell.
 */
export async function pushNotices(workspaceId: string) {
  try {
    const pending = await withWorkspace(workspaceId, (workspace) => {
      const unsent = (workspace.notices ?? []).filter((notice) => !notice.pushed);
      for (const notice of unsent) notice.pushed = true;
      return { unsent: structuredClone(unsent), tokens: Object.keys(workspace.pushTokens ?? {}), unread: (workspace.notices ?? []).slice(-NOTICES_SHOWN).filter((notice) => !notice.read).length };
    });
    if (!pending.unsent.length || !pending.tokens.length || !sender) return;
    const invalid = new Set<string>();
    for (const notice of pending.unsent) {
      const result = await sender(pending.tokens, notice, pending.unread);
      for (const token of result.invalid) invalid.add(token);
    }
    if (invalid.size) {
      await withWorkspace(workspaceId, (workspace) => {
        for (const token of invalid) delete workspace.pushTokens?.[token];
      });
    }
  } catch (error) {
    logger.warn({ err: (error as Error).message, workspaceId }, "Push notification failed");
  }
}
