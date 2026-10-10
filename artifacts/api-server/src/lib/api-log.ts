import { currentContext } from "./context";
import { logger } from "./logger";
import { appendLog, withDoc } from "./store";

/**
 * One record per outbound provider request (each retry is its own record),
 * in the append-only `api_calls` log. Never holds credentials, tokens or
 * invoice contents: only what is needed to count, time and trace calls.
 */
export type ApiOutcome = "ok" | "rejected" | "auth" | "quota" | "not_found" | "rate_limited" | "provider_down" | "timeout" | "network" | "error";
export type ApiCall = {
  at: string;
  provider: "gstinapi" | "google_routes" | "razorpay";
  operation: string;
  outcome: ApiOutcome;
  httpStatus: number;
  errorCode?: string;
  durationMs: number;
  attempt: number;
  testMode?: boolean;
  workspaceId?: string;
  requestId?: string;
  invoiceId?: string;
  /** The e-way bill number the call returned, for generate calls. */
  ewbNumber?: string;
};

export function outcomeFor(status: number): ApiOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "provider_down";
  if (status >= 400 && status < 500) return "rejected";
  return "error";
}

/** Writes the record; a logging failure never fails the business operation. */
export async function recordApiCall(call: Omit<ApiCall, "at" | "workspaceId" | "requestId" | "invoiceId"> & { at?: string }) {
  const context = currentContext();
  const record: ApiCall = {
    ...call,
    at: call.at ?? new Date().toISOString(),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.invoiceId ? { invoiceId: context.invoiceId } : {}),
  };
  try {
    await appendLog("api_calls", record as unknown as ApiCall & Record<string, unknown>);
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "Could not record API call");
  }
}

export type ProviderQuota = { provider: string; creditsRemaining: number; reportedAt: string; source: string };

/** Keeps the provider's own remaining-credit figure when a response carries one. */
export async function recordProviderQuota(provider: string, creditsRemaining: number, source: string) {
  try {
    await withDoc<ProviderQuota, null>("provider_status", provider, () => ({ next: { provider, creditsRemaining, reportedAt: new Date().toISOString(), source }, result: null }));
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "Could not record provider quota");
  }
}
