/**
 * gstinapi.in client (https://www.gstinapi.in/docs).
 *
 * - Auth: `x-api-key: <GSTINAPI_KEY>` on every request. The key is a server
 *   secret and never reaches the app.
 * - GSTIN lookup: GET /v1/gstin/{gstin} → { success, gstin, data, credits_remaining }.
 * - E-way bills: POST /v1/ewaybill[/…] with { gstin, gstin_username, password,
 *   payload, test_mode }. `gstin_username` / `password` are the taxpayer's
 *   e-way bill portal API credentials, not the gstinapi key.
 * - Status codes: 400 invalid, 401 bad key, 402 out of credits, 403
 *   deactivated, 404 not found, 429 rate limited (60/min), 502 provider down.
 */

const baseUrl = (process.env["GSTINAPI_BASE_URL"] ?? "https://www.gstinapi.in").replace(/\/+$/, "");
const apiKey = process.env["GSTINAPI_KEY"] ?? "";
/** Until GSTINAPI_TEST_MODE=false, e-way bill calls are validated but never sent to NIC. */
export const gstinApiTestMode = process.env["GSTINAPI_TEST_MODE"] !== "false";
export const gstinApiConfigured = Boolean(apiKey);

export class GstinApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

const CODES: Record<number, string> = {
  400: "INVALID_FORMAT",
  401: "UNAUTHORIZED",
  402: "INSUFFICIENT_CREDITS",
  403: "ACCOUNT_DEACTIVATED",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
  502: "PROVIDER_UNAVAILABLE",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, { timeoutMs = 20_000, retries = 2 } = {}): Promise<T> {
  if (!apiKey) throw new GstinApiError("GSTINAPI_KEY is not set on the server.", 503, "NOT_CONFIGURED");
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let json: Record<string, unknown> = {};
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "x-api-key": apiKey, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (error) {
      const timedOut = (error as Error).name === "AbortError";
      throw new GstinApiError(timedOut ? "gstinapi.in did not respond in time." : "Could not reach gstinapi.in.", 0, timedOut ? "TIMEOUT" : "NETWORK");
    } finally {
      clearTimeout(timer);
    }
    if (response.ok && json["success"] !== false) return json as T;
    // Only 429 and 502 are worth repeating; a 402 or 404 will not change.
    if ((response.status === 429 || response.status === 502) && attempt < retries) {
      await sleep(2 ** attempt * 500);
      continue;
    }
    const message = typeof json["error"] === "string" ? json["error"] : typeof json["message"] === "string" ? json["message"] : `gstinapi.in request failed (${response.status}).`;
    throw new GstinApiError(message, response.status, CODES[response.status] ?? (response.ok ? "REJECTED" : "HTTP_ERROR"), json);
  }
}

export type GstinApiTaxpayer = {
  gstin: string | null;
  legal_name: string | null;
  trade_name: string | null;
  status: string | null;
  taxpayer_type: string | null;
  registration_date: string | null;
  cancellation_date: string | null;
  state_code: string | null;
  address: string | null;
  pincode: string | null;
  block_status: string | null;
};

export function lookupGstin(gstin: string) {
  return call<{ success: true; gstin: string; data: GstinApiTaxpayer; credits_remaining?: number }>("GET", `/v1/gstin/${encodeURIComponent(gstin)}`);
}

export type EwbCredentials = { gstin: string; username: string; password: string };

/**
 * POST an e-way bill operation. `path` is relative to /v1/ewaybill; `extra`
 * adds top-level fields such as `ewaybill_no`. Never retried: a repeat could
 * create a second bill.
 */
export function ewaybillCall<T = Record<string, unknown>>(path: string, credentials: EwbCredentials, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return call<T>("POST", `/v1/ewaybill${path}`, {
    gstin: credentials.gstin,
    gstin_username: credentials.username,
    password: credentials.password,
    ...extra,
    payload,
    ...(gstinApiTestMode ? { test_mode: true } : {}),
  }, { timeoutMs: 40_000, retries: 0 });
}
