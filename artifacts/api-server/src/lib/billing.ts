import { directory } from "./admin-directory";
import { logger } from "./logger";
import { mailer } from "./mailer";
import { peekWorkspace, readDoc, withDoc, withWorkspace } from "./store";

/**
 * Invoices for credit purchases, numbered in one series per Indian financial year
 * (EWE/2026-27/0001, EWE/2026-27/0002, …). Each invoice keeps a copy of the buyer's
 * details at the time of payment, so later profile edits do not change old invoices.
 */
export const SELLER = {
  name: "E-Way Easy",
  address: "Rajkot, Gujarat, India",
  email: "bvbtrade9@gmail.com",
  website: "ewb---generator.web.app",
  logoUrl: "https://ewb---generator.web.app/logo.png",
  /** Printed only when set (BILLING_GSTIN). */
  gstin: process.env["BILLING_GSTIN"]?.trim() || null,
};

export type BillingInvoice = {
  number: string;
  purchaseId: string;
  workspaceId: string;
  issuedAt: string;
  paidAt: string;
  paymentId: string | null;
  provider: "razorpay" | "sandbox";
  credits: number;
  amountPaise: number;
  ratePaise: number;
  buyer: { name: string; gstin: string; address: string; state: string; pincode: string; email: string; phone: string };
  emailedTo?: string;
  emailedAt?: string;
};

type Counter = { next: number; issued: Record<string, number> };

/** Financial year (April–March, India time) of a date: "2026-27". */
export function financialYear(iso: string) {
  const ist = new Date(Date.parse(iso) + 330 * 60_000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Next number of the year's series; asking again for the same purchase returns its number. */
async function serialFor(fy: string, purchaseId: string) {
  return withDoc<Counter, number>("counters", `billing-${fy}`, (current) => {
    const counter = current ?? { next: 1, issued: {} };
    const existing = counter.issued[purchaseId];
    if (existing) return { next: counter, result: existing };
    const number = counter.next;
    return { next: { next: number + 1, issued: { ...counter.issued, [purchaseId]: number } }, result: number };
  });
}

async function accountEmail(workspaceId: string, fallback: string) {
  const user = await directory().get(workspaceId).catch(() => null);
  return user?.email || fallback;
}

/**
 * Issues the invoice for a paid purchase (once) and, for a new invoice, emails it
 * to the account. Never throws: a failed email does not undo a payment.
 */
export async function issueBillingInvoice(workspaceId: string, purchaseId: string, { email = true } = {}): Promise<BillingInvoice | null> {
  try {
    const existing = await readDoc<BillingInvoice>("billing_invoices", purchaseId);
    if (existing) return existing;
    const workspace = await peekWorkspace(workspaceId, { syncKeys: ["business/profile"] });
    const purchase = workspace?.purchases[purchaseId];
    if (!workspace || !purchase || purchase.status !== "paid") return null;
    const paidAt = purchase.paidAt ?? new Date().toISOString();
    const fy = financialYear(paidAt);
    const serial = await serialFor(fy, purchaseId);
    const business = (workspace.sync["business"]?.["profile"]?.data ?? {}) as Partial<Record<keyof BillingInvoice["buyer"], string>> & { name?: string };
    const draft: BillingInvoice = {
      number: `EWE/${fy}/${String(serial).padStart(4, "0")}`,
      purchaseId,
      workspaceId,
      issuedAt: new Date().toISOString(),
      paidAt,
      paymentId: purchase.paymentId ?? null,
      provider: purchase.provider,
      credits: purchase.credits,
      amountPaise: purchase.amountPaise,
      ratePaise: Math.round(purchase.amountPaise / Math.max(purchase.credits, 1)),
      buyer: {
        name: business.name ?? "",
        gstin: business.gstin ?? "",
        address: business.address ?? "",
        state: business.state ?? "",
        pincode: business.pincode ?? "",
        email: business.email ?? "",
        phone: business.phone ?? "",
      },
    };
    const { invoice, created } = await withDoc<BillingInvoice, { invoice: BillingInvoice; created: boolean }>("billing_invoices", purchaseId, (current) =>
      current ? { next: current, result: { invoice: current, created: false } } : { next: draft, result: { invoice: draft, created: true } });
    await withWorkspace(workspaceId, (current) => {
      const record = current.purchases[purchaseId];
      if (record) record.invoiceNumber = invoice.number;
    });
    if (created && email) return await emailBillingInvoice(invoice);
    return invoice;
  } catch (error) {
    logger.error({ err: (error as Error).message, purchaseId }, "Billing invoice failed");
    return null;
  }
}

/** Sends the invoice to the account email and records where it went. */
export async function emailBillingInvoice(invoice: BillingInvoice): Promise<BillingInvoice> {
  if (!mailer.configured) return invoice;
  const to = await accountEmail(invoice.workspaceId, invoice.buyer.email);
  if (!to) return invoice;
  try {
    await mailer.send({
      to,
      subject: `Payment received – Invoice ${invoice.number} – E-Way Easy`,
      text: billingInvoiceText(invoice),
      html: billingInvoiceHtml(invoice, { email: true }),
    });
    const emailedAt = new Date().toISOString();
    return await withDoc<BillingInvoice, BillingInvoice>("billing_invoices", invoice.purchaseId, (current) => {
      const next = { ...(current ?? invoice), emailedTo: to, emailedAt };
      return { next, result: next };
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, invoice: invoice.number }, "Billing invoice email failed");
    return invoice;
  }
}

/* ------------------------------------------------------------------ */
/* Layout (email-safe: tables and inline styles; also printed to PDF) */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const belowHundred = (n: number) => (n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const belowThousand = (n: number) => [Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} Hundred` : "", n % 100 ? belowHundred(n % 100) : ""].filter(Boolean).join(" ");

/** Indian numbering: 118000.50 → "One Lakh Eighteen Thousand Rupees and Fifty Paise Only". */
export function amountInWords(paise: number) {
  let rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  if (!rupees && !remainder) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000); rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000); rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rupees) parts.push(belowThousand(rupees));
  const words = parts.join(" ");
  return `${words ? `${words} Rupees` : ""}${remainder ? `${words ? " and " : ""}${belowHundred(remainder)} Paise` : ""} Only`;
}

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (iso: string, time = false) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: "Asia/Kolkata" });

export function billingInvoiceText(invoice: BillingInvoice) {
  return [
    `Thank you for your payment.`,
    ``,
    `Invoice: ${invoice.number}`,
    `Date: ${date(invoice.paidAt, true)}`,
    `Credits: ${invoice.credits}`,
    `Amount paid: ${inr(invoice.amountPaise)}`,
    invoice.paymentId ? `Payment ID: ${invoice.paymentId}` : "",
    ``,
    `You can see all your invoices in the app: Wallet → Billing invoices.`,
    ``,
    `${SELLER.name}, ${SELLER.address} · ${SELLER.email}`,
  ].filter((line, index, lines) => line || lines[index - 1]).join("\n");
}

/** The invoice page: emailed, and printed to PDF in the app. */
export function billingInvoiceHtml(invoice: BillingInvoice, { email = false } = {}) {
  const green = "#175b42", gold = "#f2b230", ink = "#1b2420", muted = "#5d6a63", line = "#e3e2da", soft = "#f3f8f5";
  const buyer = invoice.buyer;
  const buyerLines = [buyer.address, [buyer.state, buyer.pincode].filter(Boolean).join(" - ")].filter(Boolean);
  const cell = `padding:10px 12px;border-bottom:1px solid ${line};font-size:13px;color:${ink};`;
  const label = `font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${muted};font-weight:700;`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(invoice.number)}</title>
<style>@page{margin:14mm}body{margin:0}@media (max-width:520px){.stack td{display:block!important;width:100%!important;text-align:left!important}}</style></head>
<body style="margin:0;padding:${email ? "24px 12px" : "0"};background:${email ? "#eef3f0" : "#ffffff"};font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${ink};">
${email ? `<div style="max-width:640px;margin:0 auto 14px;font-size:15px;line-height:1.5;color:${ink};">Hi${buyer.name ? ` ${esc(buyer.name)}` : ""},<br>Thank you for your payment. Your credits have been added to your E-Way Easy wallet. Your invoice is below.</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${line};border-collapse:separate;">
  <tr><td style="background:${green};padding:22px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack"><tr>
      <td style="vertical-align:middle;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:12px;"><img src="${SELLER.logoUrl}" width="48" height="48" alt="E-Way Easy" style="display:block;border-radius:12px;border:0;"></td>
          <td><div style="font-size:22px;font-weight:800;color:#ffffff;">E-Way <span style="color:${gold};">Easy</span></div>
              <div style="font-size:12px;color:#d6e7de;">GST e-way bills on your phone</div></td>
        </tr></table>
      </td>
      <td style="vertical-align:middle;text-align:right;">
        <div style="font-size:24px;font-weight:800;letter-spacing:.08em;color:#ffffff;">INVOICE</div>
        <div style="display:inline-block;margin-top:6px;background:${gold};color:${ink};font-size:11px;font-weight:800;letter-spacing:.08em;padding:4px 10px;border-radius:999px;">PAID</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="height:5px;background:${gold};font-size:0;line-height:0;">&nbsp;</td></tr>

  <tr><td style="padding:20px 24px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stack"><tr>
      <td style="vertical-align:top;width:50%;padding-bottom:12px;">
        <div style="${label}">From</div>
        <div style="font-size:15px;font-weight:700;margin-top:4px;">${SELLER.name}</div>
        <div style="font-size:13px;color:${muted};line-height:1.5;">${SELLER.address}<br>${SELLER.email}${SELLER.gstin ? `<br>GSTIN: ${esc(SELLER.gstin)}` : ""}</div>
      </td>
      <td style="vertical-align:top;width:50%;text-align:right;padding-bottom:12px;">
        <div style="${label}">Invoice no.</div>
        <div style="font-size:16px;font-weight:800;color:${green};margin-top:4px;">${esc(invoice.number)}</div>
        <div style="font-size:13px;color:${muted};margin-top:6px;">Date: <b style="color:${ink};">${date(invoice.paidAt)}</b></div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 24px;">
    <div style="background:${soft};border:1px solid ${line};border-radius:12px;padding:14px 16px;">
      <div style="${label}">Billed to</div>
      <div style="font-size:15px;font-weight:700;margin-top:4px;">${esc(buyer.name || "E-Way Easy customer")}</div>
      <div style="font-size:13px;color:${muted};line-height:1.5;">${buyer.gstin ? `GSTIN: <b style="color:${ink};">${esc(buyer.gstin)}</b><br>` : ""}${buyerLines.map(esc).join("<br>")}${buyerLines.length ? "<br>" : ""}${[buyer.email, buyer.phone].filter(Boolean).map(esc).join(" · ")}</div>
    </div>
  </td></tr>

  <tr><td style="padding:18px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${line};border-radius:12px;">
      <tr style="background:${green};">
        <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#fff;">Description</td>
        <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#fff;text-align:right;">Qty</td>
        <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#fff;text-align:right;">Rate</td>
        <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#fff;text-align:right;">Amount</td>
      </tr>
      <tr>
        <td style="${cell}"><b>Wallet credits</b><br><span style="color:${muted};font-size:12px;">E-Way Easy prepaid credits</span></td>
        <td style="${cell}text-align:right;white-space:nowrap;">${invoice.credits.toLocaleString("en-IN")}</td>
        <td style="${cell}text-align:right;white-space:nowrap;">${inr(invoice.ratePaise)}</td>
        <td style="${cell}text-align:right;font-weight:700;white-space:nowrap;">${inr(invoice.amountPaise)}</td>
      </tr>
      <tr><td colspan="3" style="padding:10px 12px;font-size:13px;text-align:right;color:${muted};">Subtotal</td><td style="padding:10px 12px;font-size:13px;text-align:right;">${inr(invoice.amountPaise)}</td></tr>
      <tr style="background:${soft};"><td colspan="3" style="padding:12px;font-size:15px;font-weight:800;text-align:right;color:${green};">Total paid</td><td style="padding:12px;font-size:17px;font-weight:800;text-align:right;color:${green};white-space:nowrap;">${inr(invoice.amountPaise)}</td></tr>
    </table>
    <div style="font-size:12px;color:${muted};margin-top:8px;">Amount in words: <b style="color:${ink};">${amountInWords(invoice.amountPaise)}</b></div>
  </td></tr>

  <tr><td style="padding:18px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${line};border-radius:12px;">
      <tr><td style="padding:12px 16px 4px;${label}" colspan="2">Payment details</td></tr>
      <tr><td style="padding:4px 16px;font-size:13px;color:${muted};">Status</td><td style="padding:4px 16px;font-size:13px;text-align:right;font-weight:700;color:${green};">Paid</td></tr>
      <tr><td style="padding:4px 16px;font-size:13px;color:${muted};">Paid on</td><td style="padding:4px 16px;font-size:13px;text-align:right;">${date(invoice.paidAt, true)}</td></tr>
      <tr><td style="padding:4px 16px;font-size:13px;color:${muted};">Method</td><td style="padding:4px 16px;font-size:13px;text-align:right;">${invoice.provider === "razorpay" ? "Online · Razorpay" : "Test purchase"}</td></tr>
      ${invoice.paymentId ? `<tr><td style="padding:4px 16px;font-size:13px;color:${muted};">Payment ID</td><td style="padding:4px 16px;font-size:13px;text-align:right;font-family:monospace;">${esc(invoice.paymentId)}</td></tr>` : ""}
      <tr><td style="padding:4px 16px 12px;font-size:13px;color:${muted};">Credits added</td><td style="padding:4px 16px 12px;font-size:13px;text-align:right;font-weight:700;">+${invoice.credits.toLocaleString("en-IN")}</td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:20px 24px 22px;">
    <div style="font-size:12px;color:${muted};line-height:1.6;text-align:center;">This is a computer-generated invoice and does not need a signature.<br>
    Questions? Write to <a href="mailto:${SELLER.email}" style="color:${green};">${SELLER.email}</a> · <a href="https://${SELLER.website}/terms" style="color:${green};">Terms</a> · <a href="https://${SELLER.website}/privacy" style="color:${green};">Privacy</a></div>
  </td></tr>
  <tr><td style="background:${green};padding:10px;text-align:center;font-size:11px;color:#d6e7de;">Thank you for choosing <b style="color:#fff;">E-Way <span style="color:${gold};">Easy</span></b></td></tr>
</table>
</body></html>`;
}
