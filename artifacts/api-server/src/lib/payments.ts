import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Credit purchases. 1 credit = CREDIT_PRICE_PAISE (default 100 = ₹1).
 * Payments go through Razorpay payment links: the server creates a link,
 * the app opens it, and credits are added when Razorpay reports it paid —
 * via the webhook (payment_link.paid) or when the app checks the status.
 */

const keyId = process.env["RAZORPAY_KEY_ID"] ?? "";
const keySecret = process.env["RAZORPAY_KEY_SECRET"] ?? "";
const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"] ?? "";
const baseUrl = (process.env["RAZORPAY_BASE_URL"] ?? "https://api.razorpay.com").replace(/\/+$/, "");

export const razorpayConfigured = Boolean(keyId && keySecret);
export const creditPricePaise = Math.max(1, Number(process.env["CREDIT_PRICE_PAISE"] ?? 100));
export const creditPacks: number[] = process.env["CREDIT_PACKS_JSON"] ? (JSON.parse(process.env["CREDIT_PACKS_JSON"]) as number[]) : [50, 100, 250, 500, 1000];
export const MIN_PURCHASE = 50;
export const MAX_PURCHASE = 100_000;

type PaymentLink = { id: string; short_url: string; status: string; amount: number; amount_paid?: number; payments?: { payment_id: string; status: string }[] | null };

async function razorpay<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!response.ok) throw new Error(json.error?.description ?? `Razorpay request failed (${response.status}).`);
  return json;
}

export async function createPaymentLink(args: { workspaceId: string; credits: number; amountPaise: number; email?: string }) {
  const reference = `cr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const link = await razorpay<PaymentLink>("POST", "/v1/payment_links", {
    amount: args.amountPaise,
    currency: "INR",
    accept_partial: false,
    reference_id: reference,
    description: `${args.credits} E-Way Easy credits`,
    expire_by: Math.floor(Date.now() / 1000) + 30 * 60,
    customer: args.email ? { email: args.email } : undefined,
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: { workspace_id: args.workspaceId, credits: String(args.credits) },
  });
  return { id: link.id, shortUrl: link.short_url };
}

/** Current state of a payment link: "paid" once the full amount is captured. */
export async function fetchPaymentLink(id: string) {
  const link = await razorpay<PaymentLink>("GET", `/v1/payment_links/${encodeURIComponent(id)}`);
  const paid = link.status === "paid" && (link.amount_paid ?? 0) >= link.amount;
  return { status: paid ? ("paid" as const) : link.status === "expired" ? ("expired" as const) : link.status === "cancelled" ? ("cancelled" as const) : ("created" as const), amountPaid: link.amount_paid ?? 0, paymentId: link.payments?.find((item) => item.status === "captured")?.payment_id };
}

/** Razorpay signs the raw webhook body with HMAC-SHA256 using the webhook secret. */
export function webhookSignatureValid(rawBody: Buffer | undefined, signature: string | undefined) {
  if (!webhookSecret || !rawBody || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", webhookSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
