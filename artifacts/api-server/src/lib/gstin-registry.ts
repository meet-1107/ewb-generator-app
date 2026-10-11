import { GstinApiError, lookupGstin } from "./gstinapi";
import { readDoc, withDoc } from "./store";
import { STATES } from "./validation";

/**
 * Verified GSTIN details, shared by every workspace, in two layers:
 *
 * - Registration details (legal and trade name, address, state, PIN,
 *   registration date) are fetched once per GSTIN and then served from this
 *   registry to every user, at no provider cost.
 * - The taxpayer status (Active / Cancelled / Suspended, block status) can
 *   change, so a saved record older than GSTIN_STATUS_TTL_DAYS (default 30;
 *   0 = never) is looked up again the next time someone verifies it. That
 *   bounds the cost at one lookup per GSTIN per period, for GSTINs in use.
 *   If that refresh fails, the saved record is returned, marked stale.
 * - A GSTIN the GST network does not know is remembered for a day, so
 *   repeated taps on a mistyped-but-valid-looking GSTIN cost one lookup.
 *
 * The e-way bill portal re-validates both GSTINs on every bill it generates,
 * so a stale status can never let an invalid bill through.
 */

export type VerifiedGstin = {
  gstin: string;
  legalName: string;
  tradeName: string;
  status: string;
  taxpayerType: string;
  registrationDate: string | null;
  cancellationDate: string | null;
  stateCode: string;
  state: string;
  address: string;
  /** Locality as the GST network records it, e.g. "Saidapet, Chennai". */
  city: string;
  pincode: string;
  blockStatus: string | null;
  /** When the registration details were first fetched. */
  verifiedAt: string;
  /** When the status was last confirmed with the GST network. */
  statusCheckedAt?: string;
  source: "gstinapi.in";
};

const DAY_MS = 86_400_000;
const statusTtlDays = Number(process.env["GSTIN_STATUS_TTL_DAYS"] ?? 30);
const STATUS_TTL_MS = Number.isFinite(statusTtlDays) && statusTtlDays > 0 ? statusTtlDays * DAY_MS : Infinity;
const NOT_FOUND_TTL_MS = DAY_MS;

const inFlight = new Map<string, Promise<{ record: VerifiedGstin; cached: boolean; stale?: boolean }>>();

const checkedAt = (record: VerifiedGstin) => Date.parse(record.statusCheckedAt ?? record.verifiedAt);

/** The saved record (one database read: far cheaper than a lookup, and always the latest any server instance wrote). */
function readCached(gstin: string) {
  return readDoc<VerifiedGstin>("gstins", gstin);
}

async function writeCached(record: VerifiedGstin) {
  await withDoc<VerifiedGstin, null>("gstins", record.gstin, () => ({ next: record, result: null }));
}

function fromLookup(gstin: string, data: Awaited<ReturnType<typeof lookupGstin>>["data"], previous: VerifiedGstin | null): VerifiedGstin {
  const now = new Date().toISOString();
  const stateCode = data.state_code ?? gstin.slice(0, 2);
  // Static fields keep their saved value when a refresh returns them empty.
  const pick = (fresh: string | null | undefined, saved: string | undefined) => (fresh && fresh.trim() ? fresh : saved ?? "");
  return {
    gstin,
    legalName: pick(data.legal_name ?? data.trade_name, previous?.legalName),
    tradeName: pick(data.trade_name ?? data.legal_name, previous?.tradeName),
    status: data.status ?? previous?.status ?? "Unknown",
    taxpayerType: pick(data.taxpayer_type, previous?.taxpayerType),
    registrationDate: data.registration_date ?? previous?.registrationDate ?? null,
    cancellationDate: data.cancellation_date ?? null,
    stateCode,
    state: STATES.find((state) => state.code === stateCode)?.name ?? previous?.state ?? "",
    address: pick(data.address, previous?.address),
    city: pick(data.city ?? data.address_details?.locality, previous?.city),
    pincode: pick(data.pincode ?? data.address_details?.pincode, previous?.pincode),
    blockStatus: data.block_status ?? null,
    verifiedAt: previous?.verifiedAt ?? now,
    statusCheckedAt: now,
    source: "gstinapi.in",
  };
}

/**
 * Returns the registered details: from the registry when fresh, otherwise
 * looked up (and saved). Concurrent calls for one GSTIN share one request.
 */
export function verifyGstin(gstin: string): Promise<{ record: VerifiedGstin; cached: boolean; stale?: boolean }> {
  const pending = inFlight.get(gstin);
  if (pending) return pending;
  const task = (async () => {
    const cached = await readCached(gstin);
    if (cached && Date.now() - checkedAt(cached) < STATUS_TTL_MS) return { record: cached, cached: true };
    if (!cached) {
      const missing = await readDoc<{ at: string }>("gstins_missing", gstin);
      if (missing && Date.now() - Date.parse(missing.at) < NOT_FOUND_TTL_MS) throw new GstinApiError("This GSTIN is not registered with the GST network.", 404, "NOT_FOUND");
    }
    let data;
    try {
      ({ data } = await lookupGstin(gstin));
      if (!data?.legal_name && !data?.trade_name && !cached) throw new GstinApiError("No details were returned for this GSTIN.", 404, "NOT_FOUND");
    } catch (error) {
      if (error instanceof GstinApiError && error.code === "NOT_FOUND" && !cached) {
        await withDoc<{ at: string }, null>("gstins_missing", gstin, () => ({ next: { at: new Date().toISOString() }, result: null }));
        throw error;
      }
      // The status could not be refreshed: the saved details are still right; say how old the status is.
      if (cached) return { record: cached, cached: true, stale: true };
      throw error;
    }
    const record = fromLookup(gstin, data, cached);
    await writeCached(record);
    return { record, cached: false };
  })().finally(() => inFlight.delete(gstin));
  inFlight.set(gstin, task);
  return task;
}
