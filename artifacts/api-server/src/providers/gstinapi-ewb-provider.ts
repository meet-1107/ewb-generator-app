import { ewaybillCall, gstinApiTestMode, GstinApiError, type EwbCredentials } from "../lib/gstinapi";
import { computeValidity, stateFromName, validateEwb, type EwbInput } from "../lib/validation";
import type { ActionResult, ConsolidateResult, EwbProvider, GenerateResult, Movement, ProviderContext } from "./ewb-provider";

/**
 * E-way bills through gstinapi.in (EWB_PROVIDER=gstinapi).
 *
 * Confirmed from the docs: POST /v1/ewaybill (generate, NIC JSON in
 * `payload`) and POST /v1/ewaybill/cancel (with `ewaybill_no`). Part-B,
 * consolidation and extension paths are taken from GSTINAPI_PATHS_JSON, e.g.
 * {"vehicle":"/vehicle","consolidate":"/consolidate","extend":"/extend"};
 * an operation without a configured path is refused without charging.
 *
 * GSTINAPI_TEST_MODE (default on) sends `test_mode: true`: fields are
 * validated but nothing reaches NIC and gstinapi.in charges nothing.
 */

const paths: Record<string, string | undefined> = {
  generate: "",
  cancel: "/cancel",
  ...(process.env["GSTINAPI_PATHS_JSON"] ? (JSON.parse(process.env["GSTINAPI_PATHS_JSON"]) as Record<string, string>) : {}),
};

// NIC master codes.
const TRANS_MODE: Record<string, string> = { Road: "1", Rail: "2", Air: "3", Ship: "4" };
const UNIT: Record<string, string> = { Nos: "NOS", Kgs: "KGS", Mtr: "MTR", Ltr: "LTR", Box: "BOX", Pcs: "PCS", Set: "SET", Ton: "TON", Hrs: "OTH", OTH: "OTH" };
const CANCEL_REASON: Record<string, number> = { Duplicate: 1, "Order cancelled": 2, "Data entry mistake": 3, Others: 4 };
const VEHICLE_REASON: Record<string, string> = { Breakdown: "1", Transhipment: "2", Others: "3", "First time": "4" };
const EXTEND_REASON: Record<string, number> = { "Natural calamity": 1, "Law and order situation": 2, Transhipment: 4, Accident: 5, Others: 99 };

const rupees = (paise: number) => Math.round(paise) / 100;
/** YYYY-MM-DD → DD/MM/YYYY */
const nicDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const stateCode = (name: string) => Number(stateFromName(name)?.code ?? 0);

/** Parses NIC timestamps ("12/10/2026 11:59:00 PM", IST) and ISO strings. */
function parseNicTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
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
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: "PROVIDER_ERROR", message: "The e-way bill service returned an unexpected error." };
}

function notConnected(operation: string): { ok: false; code: string; message: string } {
  return { ok: false, code: "NOT_CONNECTED", message: `${operation} is not connected to gstinapi.in yet. Nothing was charged.` };
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
  const mode = TRANS_MODE[input.transport.mode] ?? "1";
  return {
    supplyType: "O",
    subSupplyType: "1",
    docType: "INV",
    docNo: input.invoiceNumber,
    docDate: nicDate(input.invoiceDate),
    fromGstin: input.seller.gstin,
    fromTrdName: input.seller.name,
    fromAddr1: input.seller.address.slice(0, 120),
    fromPlace: input.seller.address.split(",").pop()?.trim().slice(0, 50) || input.seller.state,
    fromPincode: Number(input.seller.pincode),
    fromStateCode: fromState,
    actFromStateCode: fromState,
    toGstin: input.buyer.gstin || "URP",
    toTrdName: input.buyer.name,
    toAddr1: input.buyer.address.slice(0, 120),
    toPlace: input.buyer.address.split(",").pop()?.trim().slice(0, 50) || input.buyer.state,
    toPincode: Number(input.buyer.pincode),
    toStateCode: toState,
    actToStateCode: toState,
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
      body = await ewaybillCall(paths["generate"]!, credentials, buildGeneratePayload(input));
    } catch (error) {
      return { ...failure(error), issues: [] };
    }
    const ewbNumber = String(pick(body, ["ewayBillNo", "ewbNo", "ewaybill_no", "eway_bill_no", "ewb_no"]) ?? "");
    if (!ewbNumber) return { ok: false, code: "NO_NUMBER", message: "The provider did not return an e-way bill number.", issues: [] };
    const generatedAt = parseNicTime(pick(body, ["ewayBillDate", "ewbDate", "ewaybill_date", "generated_at"])) ?? new Date();
    const fallback = computeValidity(generatedAt, Number(input.transport.distanceKm), input.transport.vehicleType);
    const validUntil = parseNicTime(pick(body, ["validUpto", "valid_upto", "validUntil", "valid_until"])) ?? fallback.validUntil;
    return {
      ok: true,
      providerBillId: ewbNumber,
      ewbNumber,
      generatedAt,
      validUntil,
      validityDays: Math.max(1, Math.round((validUntil.getTime() - generatedAt.getTime()) / 86_400_000)),
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
      await ewaybillCall(paths["cancel"]!, credentials, { ewbNo: Number(ewbNumber), cancelRsnCode: CANCEL_REASON[reason] ?? 4, cancelRmrk: reason.slice(0, 50) }, { ewaybill_no: ewbNumber });
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  async updateVehicle(args: { ewbNumber: string; vehicleNumber: string; reason: string } & Movement, ctx: ProviderContext): Promise<ActionResult> {
    if (paths["vehicle"] === undefined) return notConnected("Part-B / vehicle update");
    const credentials = needCredentials(ctx);
    if ("ok" in credentials) return credentials;
    try {
      await ewaybillCall(paths["vehicle"], credentials, {
        ewbNo: Number(args.ewbNumber),
        vehicleNo: args.vehicleNumber,
        fromPlace: args.fromPlace,
        fromState: stateCode(args.fromState),
        reasonCode: VEHICLE_REASON[args.reason] ?? "3",
        reasonRem: args.reason.slice(0, 50),
        transMode: TRANS_MODE[args.transMode] ?? "1",
        transDocNo: args.transDocNo ?? "",
        transDocDate: nicDate(args.transDocDate ?? ""),
      }, { ewaybill_no: args.ewbNumber });
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  async extend(args: { ewbNumber: string; validUntil: Date; distanceKm: number; remainingKm: number; reason: string; vehicleNumber?: string } & Movement, ctx: ProviderContext): Promise<ActionResult> {
    if (paths["extend"] === undefined) return notConnected("Extending validity");
    const credentials = needCredentials(ctx);
    if ("ok" in credentials) return credentials;
    try {
      const body = await ewaybillCall(paths["extend"], credentials, {
        ewbNo: Number(args.ewbNumber),
        vehicleNo: args.vehicleNumber ?? "",
        fromPlace: args.fromPlace,
        fromState: stateCode(args.fromState),
        remainingDistance: args.remainingKm,
        transMode: TRANS_MODE[args.transMode] ?? "1",
        transDocNo: args.transDocNo ?? "",
        transDocDate: nicDate(args.transDocDate ?? ""),
        extnRsnCode: EXTEND_REASON[args.reason] ?? 99,
        extnRemarks: args.reason.slice(0, 50),
        consignmentStatus: "M",
      }, { ewaybill_no: args.ewbNumber });
      return { ok: true, validUntil: parseNicTime(pick(body, ["validUpto", "valid_upto"])) ?? computeValidity(new Date(), args.remainingKm).validUntil };
    } catch (error) {
      return failure(error);
    }
  }

  async consolidate(args: { ewbNumbers: string[]; vehicleNumber: string } & Movement, ctx: ProviderContext): Promise<ConsolidateResult> {
    if (paths["consolidate"] === undefined) return notConnected("Consolidated e-way bill");
    const credentials = needCredentials(ctx);
    if ("ok" in credentials) return credentials;
    try {
      const body = await ewaybillCall(paths["consolidate"], credentials, {
        fromPlace: args.fromPlace,
        fromState: stateCode(args.fromState),
        vehicleNo: args.vehicleNumber,
        transMode: TRANS_MODE[args.transMode] ?? "1",
        transDocNo: args.transDocNo ?? "",
        transDocDate: nicDate(args.transDocDate ?? ""),
        tripSheetEwbBills: args.ewbNumbers.map((ewbNo) => ({ ewbNo: Number(ewbNo) })),
      });
      const cewbNumber = String(pick(body, ["cEwbNo", "cewbNo", "cewb_no", "consolidated_ewb_no"]) ?? "");
      if (!cewbNumber) return { ok: false, code: "NO_NUMBER", message: "The provider did not return a consolidated e-way bill number." };
      return { ok: true, cewbNumber, generatedAt: parseNicTime(pick(body, ["cEWBDate", "cewbDate", "cewb_date"])) ?? new Date() };
    } catch (error) {
      return failure(error);
    }
  }
}
