import { ewaybillCall, gstinApiTestMode, GstinApiError, type EwbCredentials } from "../lib/gstinapi";
import { computeValidity, stateFromName, validateEwb, type EwbInput } from "../lib/validation";
import type { ActionResult, ConsolidateResult, EwbProvider, GenerateResult, Movement, ProviderContext } from "./ewb-provider";

/**
 * E-way bills through gstinapi.in (EWB_PROVIDER=gstinapi), per
 * https://www.gstinapi.in/docs:
 *
 *   POST /v1/ewaybill                  generate (NIC JSON in `payload`)
 *   POST /v1/ewaybill/update-vehicle   Part-B
 *   POST /v1/ewaybill/extend-validity  extend
 *   POST /v1/ewaybill/consolidated     consolidated e-way bill
 *   POST /v1/ewaybill/cancel           cancel
 *   POST /v1/ewaybill/credentials/test check a portal API login
 *
 * Every call carries gstin / gstin_username / password; the non-generate
 * calls take their fields at the top level in snake_case. A rejection (400)
 * or provider outage (502) is never charged by gstinapi.in, and a generate
 * retried with the same docNo returns the original bill (already_existed).
 *
 * GSTINAPI_TEST_MODE (default on) sends `test_mode: true`: fields are
 * validated but nothing reaches NIC and gstinapi.in charges nothing.
 */

// NIC master codes.
const TRANS_MODE: Record<string, string> = { Road: "1", Rail: "2", Air: "3", Ship: "4" };
const UNIT: Record<string, string> = { Nos: "NOS", Kgs: "KGS", Mtr: "MTR", Ltr: "LTR", Box: "BOX", Pcs: "PCS", Set: "SET", Ton: "TON", Hrs: "OTH", OTH: "OTH" };
const CANCEL_REASON: Record<string, string> = { Duplicate: "1", "Order cancelled": "2", "Data entry mistake": "3", Others: "4" };
const VEHICLE_REASON: Record<string, string> = { Breakdown: "1", Transhipment: "2", Others: "3", "First time": "4" };
const EXTEND_REASON: Record<string, number> = { "Natural calamity": 1, "Law and order situation": 2, Transhipment: 4, Accident: 5, Others: 99 };

const rupees = (paise: number) => Math.round(paise) / 100;
/** YYYY-MM-DD → DD/MM/YYYY */
const nicDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const stateCode = (name: string) => Number(stateFromName(name)?.code ?? 0);

/**
 * Parses NIC timestamps ("12/10/2026 11:59:00 PM", IST), NIC dates
 * ("12/10/2026" → `dateOnly` time of that day, IST) and ISO strings.
 */
function parseNicTime(value: unknown, dateOnly: "start" | "end" = "start"): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const day = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (day) {
    const [, dd, mm, yyyy] = day;
    const [h, m, sec] = dateOnly === "end" ? [23, 59, 59] : [0, 0, 0];
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), h, m, sec) - 5.5 * 3_600_000);
  }
  const nic = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(value.trim());
  if (nic) {
    const [, dd, mm, yyyy, hh, min, ss = "0", ampm] = nic;
    let hour = Number(hh) % 12;
    if (!ampm) hour = Number(hh);
    else if (ampm.toUpperCase() === "PM") hour += 12;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hour, Number(min), Number(ss)) - 5.5 * 3_600_000);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Finds the first matching key in the response, its `data` or `result`. */
function pick(body: Record<string, unknown>, keys: string[]): unknown {
  for (const scope of [body, body["data"], body["result"]]) {
    if (!scope || typeof scope !== "object") continue;
    for (const key of keys) {
      const value = (scope as Record<string, unknown>)[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

function failure(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof GstinApiError) {
    if (error.code === "INSUFFICIENT_CREDITS") return { ok: false, code: "PROVIDER_CREDITS", message: "The e-way bill service is temporarily unavailable. Nothing was charged; try again later." };
    if (error.code === "UNAUTHORIZED" || error.code === "NOT_CONFIGURED") return { ok: false, code: "PROVIDER_SETUP", message: "The e-way bill service is not set up correctly on the server." };
    // A 400 here is the filing system rejecting the document (never charged by gstinapi.in).
    return { ok: false, code: error.status === 400 ? "REJECTED" : error.code, message: error.message };
  }
  return { ok: false, code: "PROVIDER_ERROR", message: "The e-way bill service returned an unexpected error." };
}

function needCredentials(ctx: ProviderContext): EwbCredentials | { ok: false; code: string; message: string } {
  return ctx.credentials ?? { ok: false, code: "CREDENTIALS_MISSING", message: "Add your e-way bill portal API login for this GSTIN first (Account → E-way bill portal login)." };
}

export function buildGeneratePayload(input: EwbInput) {
  const inter = input.supplyType === "inter";
  const tax = (line: EwbInput["lines"][number]) => Math.round((line.taxablePaise * line.taxRate) / 100);
  const taxTotal = input.lines.reduce((sum, line) => sum + tax(line), 0);
  const half = Math.round(taxTotal / 2);
  const fromState = stateCode(input.seller.state);
  const toState = stateCode(input.buyer.state);
  // The goods move from the dispatch place to the delivery place; the GSTIN states stay the parties'.
  const from = input.dispatch ?? input.seller;
  const to = input.shipTo ?? input.buyer;
  const mode = TRANS_MODE[input.transport.mode] ?? "1";
  return {
    supplyType: "O",
    subSupplyType: "1",
    docType: "INV",
    docNo: input.invoiceNumber,
    docDate: nicDate(input.invoiceDate),
    fromGstin: input.seller.gstin,
    fromTrdName: input.seller.name,
    fromAddr1: from.address.slice(0, 120),
    fromPlace: from.address.split(",").pop()?.trim().slice(0, 50) || from.state,
    fromPincode: Number(from.pincode),
    fromStateCode: fromState,
    actFromStateCode: stateCode(from.state),
    toGstin: input.buyer.gstin || "URP",
    toTrdName: input.buyer.name,
    toAddr1: to.address.slice(0, 120),
    toPlace: to.address.split(",").pop()?.trim().slice(0, 50) || to.state,
    toPincode: Number(to.pincode),
    toStateCode: toState,
    actToStateCode: stateCode(to.state),
    transactionType: 1,
    totalValue: rupees(input.totals.taxable),
    cgstValue: inter ? 0 : rupees(half),
    sgstValue: inter ? 0 : rupees(taxTotal - half),
    igstValue: inter ? rupees(taxTotal) : 0,
    cessValue: 0,
    cessNonAdvolValue: 0,
    otherValue: 0,
    totInvValue: rupees(input.totals.total),
    transporterId: input.transport.transporterId,
    transporterName: input.transport.transporterName,
    transDistance: String(Number(input.transport.distanceKm)),
    transMode: mode,
    ...(mode === "1"
      ? { vehicleNo: input.transport.vehicleNumber, vehicleType: input.transport.vehicleType === "odc" ? "O" : "R" }
      : { transDocNo: input.transport.docNumber ?? "", transDocDate: nicDate(input.transport.docDate ?? "") }),
    itemList: input.lines
      .filter((line) => line.description.trim() && line.taxablePaise > 0)
      .map((line) => ({
        productName: line.description.slice(0, 100),
        productDesc: line.description.slice(0, 100),
        hsnCode: Number(line.hsn),
        quantity: Number(line.quantity),
        qtyUnit: UNIT[line.unit] ?? "OTH",
        taxableAmount: rupees(line.taxablePaise),
        cgstRate: inter ? 0 : line.taxRate / 2,
        sgstRate: inter ? 0 : line.taxRate / 2,
        igstRate: inter ? line.taxRate : 0,
        cessRate: 0,
      })),
  };
}

export class GstinApiEwbProvider implements EwbProvider {
  readonly id = "gstinapi";
  readonly label = gstinApiTestMode ? "gstinapi.in (test mode — not sent to NIC)" : "gstinapi.in (live NIC e-way bill system)";
  readonly sandbox = gstinApiTestMode;
  readonly needsCredentials = true;

  validate(input: EwbInput) {
    return validateEwb(input);
  }

  async generate(input: EwbInput, ctx: ProviderContext): Promise<GenerateResult> {
    const { issues } = this.validate(input);
    if (issues.length) return { ok: false, code: "VALIDATION_FAILED", message: "Some fields need fixing before submission.", issues };
    const credentials = needCredentials(ctx);
    if ("ok" in credentials) return { ...credentials, issues: [] };
    let body: Record<string, unknown>;
    try {
      // Safe to retry: the same docNo returns the original bill (already_existed).
      body = await ewaybillCall("", credentials, { payload: buildGeneratePayload(input) }, { retries: 2 });
    } catch (error) {
      return { ...failure(error), issues: [] };
    }
    const ewbNumber = String(pick(body, ["ewaybill_no", "ewayBillNo", "ewbNo"]) ?? "");
    if (!ewbNumber) return { ok: false, code: "NO_NUMBER", message: "The provider did not return an e-way bill number.", issues: [] };
    const now = new Date();
    const stamped = parseNicTime(pick(body, ["ewaybill_date", "ewayBillDate"]));
    // ewaybill_date may be date-only; never place generation before today's midnight or in the future.
    const generatedAt = stamped && stamped.getTime() <= now.getTime() && now.getTime() - stamped.getTime() < 86_400_000 ? now : stamped ?? now;
    const fallback = computeValidity(generatedAt, Number(input.transport.distanceKm), input.transport.vehicleType);
    const validUntil = parseNicTime(pick(body, ["valid_upto", "validUpto"]), "end") ?? fallback.validUntil;
    return {
      ok: true,
      providerBillId: ewbNumber,
      ewbNumber,
      generatedAt,
      validUntil,
      validityDays: Math.max(1, Math.ceil((validUntil.getTime() - generatedAt.getTime()) / 86_400_000)),
      partBPending: input.transport.mode === "Road" && !input.transport.vehicleNumber.trim(),
    };
  }

  async cancel({ ewbNumber, generatedAt, reason }: { ewbNumber: string; generatedAt: Date; reason: string }, ctx: ProviderContext): Promise<ActionResult> {
    if (Date.now() - generatedAt.getTime() > 24 * 3_600_000) {
      return { ok: false, code: "CANCEL_WINDOW", message: "An e-way bill can be cancelled only within 24 hours of generation." };
    }
    const credentials = needCredentials(ctx);
    if ("ok" in credentials) return credentials;
    try {
      await ewaybillCall("/cancel", credentials, { ewaybill_no: ewbNumber, cancel_reason_code: CANCEL_REASON[reason] ?? "4", cancel_remark: reason.slice(0, 50) });
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  async updateVehicle(args: { ewbNumber: string; vehicleNumber: string; reason: string } & Movement, ctx: ProviderContext): Promise<ActionResult> {
    const credentials = needCredentials(ctx);
    if ("ok" in credentials) return credentials;
    const mode = TRANS_MODE[args.transMode] ?? "1";
    try {
      const body = await ewaybillCall("/update-vehicle", credentials, {
        ewaybill_no: args.ewbNumber,
        vehicle_no: args.vehicleNumber,
        from_place: args.fromPlace.slice(0, 50),
        from_state: stateCode(args.fromState),
        reason_code: VEHICLE_REASON[args.reason] ?? "3",
        reason_remark: args.reason.slice(0, 50),
        trans_mode: mode,
        ...(mode !== "1" && args.transDocNo ? { trans_doc_no: args.transDocNo, trans_doc_date: nicDate(args.transDocDate ?? "") } : {}),
      });
      const validUntil = parseNicTime(pick(body, ["valid_upto", "validUpto"]), "end");
      return { ok: true, ...(validUntil ? { validUntil } : {}) };
    } catch (error) {
      return failure(error);
    }
  }

  async extend(args: { ewbNumber: string; validUntil: Date; distanceKm: number; remainingKm: number; reason: string; vehicleNumber?: string; fromPincode?: string } & Movement, ctx: ProviderContext): Promise<ActionResult> {
    const credentials = needCredentials(ctx);
    if ("ok" in credentials) return credentials;
    if (!/^[1-9]\d{5}$/.test(args.fromPincode ?? "")) return { ok: false, code: "PINCODE_REQUIRED", message: "Enter the 6-digit PIN code of the current place." };
    const mode = TRANS_MODE[args.transMode] ?? "1";
    try {
      const body = await ewaybillCall("/extend-validity", credentials, {
        ewaybill_no: args.ewbNumber,
        from_place: args.fromPlace.slice(0, 50),
        from_state: stateCode(args.fromState),
        from_pincode: Number(args.fromPincode),
        remaining_distance: args.remainingKm,
        extension_reason_code: EXTEND_REASON[args.reason] ?? 99,
        extension_remark: args.reason.slice(0, 50),
        consignment_status: "M",
        trans_mode: mode,
        ...(args.vehicleNumber ? { vehicle_no: args.vehicleNumber } : {}),
        ...(mode !== "1" && args.transDocNo ? { trans_doc_no: args.transDocNo, trans_doc_date: nicDate(args.transDocDate ?? "") } : {}),
      });
      return { ok: true, validUntil: parseNicTime(pick(body, ["valid_upto", "validUpto"]), "end") ?? computeValidity(new Date(), args.remainingKm).validUntil };
    } catch (error) {
      return failure(error);
    }
  }

  async consolidate(args: { ewbNumbers: string[]; vehicleNumber: string } & Movement, ctx: ProviderContext): Promise<ConsolidateResult> {
    const credentials = needCredentials(ctx);
    if ("ok" in credentials) return credentials;
    const mode = TRANS_MODE[args.transMode] ?? "1";
    try {
      const body = await ewaybillCall("/consolidated", credentials, {
        ewaybill_nos: args.ewbNumbers,
        from_place: args.fromPlace.slice(0, 50),
        from_state: stateCode(args.fromState),
        trans_mode: mode,
        ...(mode === "1" ? { vehicle_no: args.vehicleNumber } : { trans_doc_no: args.transDocNo ?? "", trans_doc_date: nicDate(args.transDocDate ?? "") }),
      });
      const cewbNumber = String(pick(body, ["consolidated_ewaybill_no", "cEwbNo"]) ?? "");
      if (!cewbNumber) return { ok: false, code: "NO_NUMBER", message: "The provider did not return a consolidated e-way bill number." };
      return { ok: true, cewbNumber, generatedAt: parseNicTime(pick(body, ["consolidated_ewaybill_date", "cEWBDate"])) ?? new Date() };
    } catch (error) {
      return failure(error);
    }
  }
}

/** Checks a portal API login with gstinapi.in (free; limited to 3 per GSTIN per 15 min). */
export async function testCredentials(credentials: EwbCredentials): Promise<{ valid: boolean | null; message: string }> {
  try {
    const body = await ewaybillCall("/credentials/test", credentials, {}, { testMode: false });
    return { valid: body["valid"] !== false, message: typeof body["message"] === "string" ? body["message"] : "Login works." };
  } catch (error) {
    if (error instanceof GstinApiError && (error.code === "RATE_LIMITED" || error.code === "PROVIDER_UNAVAILABLE" || error.code === "TIMEOUT" || error.code === "NETWORK")) {
      return { valid: null, message: "Could not check the login right now; it was saved and will be checked on first use." };
    }
    if (error instanceof GstinApiError && error.status === 400) return { valid: false, message: error.message };
    throw error;
  }
}
