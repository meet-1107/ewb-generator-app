import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { GstinApiError, lookupGstin } from "./gstinapi";
import { sharedFile } from "./store";
import { STATES } from "./validation";

/**
 * Verified GSTIN details, shared by every workspace. A GSTIN is looked up on
 * gstinapi.in once; later verifications (by any user) are served from here,
 * so each GSTIN costs one API credit in total.
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
  pincode: string;
  blockStatus: string | null;
  verifiedAt: string;
  source: "gstinapi.in";
};

const memory = new Map<string, VerifiedGstin>();
const inFlight = new Map<string, Promise<{ record: VerifiedGstin; cached: boolean }>>();

function fileFor(gstin: string) {
  return sharedFile("gstins", `${gstin}.json`);
}

async function readCached(gstin: string) {
  const hit = memory.get(gstin);
  if (hit) return hit;
  try {
    const record = JSON.parse(await readFile(fileFor(gstin), "utf8")) as VerifiedGstin;
    memory.set(gstin, record);
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

async function writeCached(record: VerifiedGstin) {
  const file = fileFor(record.gstin);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(record));
  await rename(temp, file);
  memory.set(record.gstin, record);
}

/** Returns saved details, or looks the GSTIN up once and saves them. Concurrent calls share one request. */
export function verifyGstin(gstin: string): Promise<{ record: VerifiedGstin; cached: boolean }> {
  const pending = inFlight.get(gstin);
  if (pending) return pending;
  const task = (async () => {
    const cached = await readCached(gstin);
    if (cached) return { record: cached, cached: true };
    const { data } = await lookupGstin(gstin);
    if (!data?.legal_name && !data?.trade_name) throw new GstinApiError("No details were returned for this GSTIN.", 404, "NOT_FOUND");
    const stateCode = data.state_code ?? gstin.slice(0, 2);
    const record: VerifiedGstin = {
      gstin,
      legalName: data.legal_name ?? data.trade_name ?? "",
      tradeName: data.trade_name ?? data.legal_name ?? "",
      status: data.status ?? "Unknown",
      taxpayerType: data.taxpayer_type ?? "",
      registrationDate: data.registration_date,
      cancellationDate: data.cancellation_date,
      stateCode,
      state: STATES.find((state) => state.code === stateCode)?.name ?? "",
      address: data.address ?? "",
      pincode: data.pincode ?? "",
      blockStatus: data.block_status,
      verifiedAt: new Date().toISOString(),
      source: "gstinapi.in",
    };
    await writeCached(record);
    return { record, cached: false };
  })().finally(() => inFlight.delete(gstin));
  inFlight.set(gstin, task);
  return task;
}
