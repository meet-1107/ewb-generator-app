/**
 * Transactional email through Resend (https://resend.com): RESEND_API_KEY and
 * EMAIL_FROM, a sender on a domain verified in Resend. For a first test,
 * EMAIL_FROM="E-Way Easy <onboarding@resend.dev>" delivers to your own Resend
 * account email only. Codes are never written to logs.
 */

export type Email = { to: string; subject: string; text: string; html: string };
export interface Mailer {
  readonly configured: boolean;
  send(email: Email): Promise<void>;
}

const apiKey = process.env["RESEND_API_KEY"] ?? "";
const from = process.env["EMAIL_FROM"] ?? "";
const resendUrl = (process.env["RESEND_BASE_URL"] ?? "https://api.resend.com").replace(/\/+$/, "");

export const mailer: Mailer = {
  configured: Boolean(apiKey && from),
  async send(email) {
    const response = await fetch(`${resendUrl}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Email provider answered ${response.status}`);
  },
};
