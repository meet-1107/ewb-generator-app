import { randomInt } from "node:crypto";
import { gstinApiConfigured, type EwbCredentials } from "../lib/gstinapi";
import { computeValidity, validateEwb, VEHICLE_PATTERN, type EwbInput, type FieldIssue } from "../lib/validation";
import { GstinApiEwbProvider } from "./gstinapi-ewb-provider";

/**
 * Provider adapter boundary. Screens and routes only see these normalized
 * shapes; a real GSP / NIC integration implements the same interface and is
 * selected with EWB_PROVIDER. Credentials stay in server-side secrets.
 */

export type GenerateResult =
  | { ok: true; providerBillId: string; ewbNumber: string; generatedAt: Date; validUntil: Date; validityDays: number; partBPending: boolean }
  | { ok: false; code: string; message: string; issues: FieldIssue[] };

export type ActionResult = { ok: true; validUntil?: Date } | { ok: false; code: string; message: string };
export type ConsolidateResult = { ok: true; cewbNumber: string; generatedAt: Date } | { ok: false; code: string; message: string };

/** Taxpayer's e-way bill portal API login for the seller GSTIN; null for providers that don't need it. */
export type ProviderContext = { credentials: EwbCredentials | null };

/** Where the goods are when Part-B / consolidation happens. */
export type Movement = { fromPlace: string; fromState: string; transMode: string; transDocNo?: string; transDocDate?: string };

export interface EwbProvider {
  readonly id: string;
  readonly label: string;
  readonly sandbox: boolean;
  /** True when calls need the seller GSTIN's e-way bill portal credentials. */
  readonly needsCredentials: boolean;
  validate(input: EwbInput): { issues: FieldIssue[]; warnings: string[] };
  generate(input: EwbInput, ctx: ProviderContext): Promise<GenerateResult>;
  extend(args: { ewbNumber: string; validUntil: Date; distanceKm: number; remainingKm: number; reason: string; vehicleNumber?: string; fromPincode?: string } & Movement, ctx: ProviderContext): Promise<ActionResult>;
  cancel(args: { ewbNumber: string; generatedAt: Date; reason: string }, ctx: ProviderContext): Promise<ActionResult>;
  updateVehicle(args: { ewbNumber: string; vehicleNumber: string; reason: string } & Movement, ctx: ProviderContext): Promise<ActionResult>;
  consolidate(args: { ewbNumbers: string[]; vehicleNumber: string } & Movement, ctx: ProviderContext): Promise<ConsolidateResult>;
}

const latency = () => new Promise((resolve) => setTimeout(resolve, 350 + randomInt(400)));

class SandboxEwbProvider implements EwbProvider {
  readonly id = "sandbox";
  readonly label = "Sandbox provider (test only — not sent to NIC)";
  readonly sandbox = true;
  readonly needsCredentials = false;

  validate(input: EwbInput) {
    return validateEwb(input);
  }

  async generate(input: EwbInput): Promise<GenerateResult> {
    await latency();
    const { issues } = this.validate(input);
    if (issues.length) return { ok: false, code: "VALIDATION_FAILED", message: "The provider rejected some fields.", issues };
    const generatedAt = new Date();
    const { validUntil, days } = computeValidity(generatedAt, Number(input.transport.distanceKm), input.transport.vehicleType);
    // Sandbox numbers start with 9 so they can never be mistaken for a live NIC series.
    const ewbNumber = `9${String(randomInt(10 ** 10, 10 ** 11 - 1))}`;
    return {
      ok: true,
      providerBillId: `SBX-${ewbNumber}`,
      ewbNumber,
      generatedAt,
      validUntil,
      validityDays: days,
      partBPending: input.transport.mode === "Road" && !input.transport.vehicleNumber.trim(),
    };
  }

  async extend({ validUntil, remainingKm, reason }: { validUntil: Date; distanceKm: number; remainingKm: number; reason: string }): Promise<ActionResult> {
    await latency();
    const now = Date.now();
    const window = 8 * 3_600_000;
    if (now < validUntil.getTime() - window || now > validUntil.getTime() + window) {
      return { ok: false, code: "EXTEND_WINDOW", message: "Validity can be extended only within 8 hours before or after expiry." };
    }
    if (!reason.trim()) return { ok: false, code: "REASON_REQUIRED", message: "Give a reason for the extension." };
    if (!(remainingKm > 0 && remainingKm <= 4000)) return { ok: false, code: "DISTANCE", message: "Remaining distance must be between 1 and 4000 km." };
    return { ok: true, validUntil: computeValidity(new Date(Math.max(now, validUntil.getTime())), remainingKm).validUntil };
  }

  async cancel({ generatedAt, reason }: { generatedAt: Date; reason: string }): Promise<ActionResult> {
    await latency();
    if (Date.now() - generatedAt.getTime() > 24 * 3_600_000) {
      return { ok: false, code: "CANCEL_WINDOW", message: "An e-way bill can be cancelled only within 24 hours of generation." };
    }
    if (!reason.trim()) return { ok: false, code: "REASON_REQUIRED", message: "Choose a reason for cancelling." };
    return { ok: true };
  }

  async updateVehicle({ vehicleNumber, reason }: { vehicleNumber: string; reason: string }): Promise<ActionResult> {
    await latency();
    if (!VEHICLE_PATTERN.test(vehicleNumber)) {
      return { ok: false, code: "VEHICLE_FORMAT", message: "Vehicle number format looks wrong (example: MH12AB1234)." };
    }
    if (!reason.trim()) return { ok: false, code: "REASON_REQUIRED", message: "Choose a reason for the vehicle change." };
    return { ok: true };
  }

  async consolidate({ ewbNumbers, vehicleNumber, fromPlace }: { ewbNumbers: string[]; vehicleNumber: string } & Movement): Promise<ConsolidateResult> {
    await latency();
    if (!ewbNumbers.length) return { ok: false, code: "NO_BILLS", message: "Choose at least one e-way bill." };
    if (!VEHICLE_PATTERN.test(vehicleNumber)) return { ok: false, code: "VEHICLE_FORMAT", message: "Vehicle number format looks wrong (example: MH12AB1234)." };
    if (!fromPlace.trim()) return { ok: false, code: "PLACE_REQUIRED", message: "Enter the place the vehicle starts from." };
    return { ok: true, cewbNumber: `9${String(randomInt(10 ** 9, 10 ** 10 - 1))}`, generatedAt: new Date() };
  }
}

const providers: Record<string, () => EwbProvider | null> = {
  sandbox: () => new SandboxEwbProvider(),
  // Without GSTINAPI_KEY the routes answer "provider not configured" instead of failing at startup.
  gstinapi: () => (gstinApiConfigured ? new GstinApiEwbProvider() : null),
};

// Tolerates the usual .env slips: quotes, spaces, capitals, a trailing "# comment".
const selected = (process.env["EWB_PROVIDER"] ?? "sandbox").replace(/\s+#.*$/, "").replace(/^["'\s]+|["'\s]+$/g, "").toLowerCase() || "sandbox";
/** The EWB_PROVIDER value as the server read it (not a secret), for the admin health page. */
export const ewbProviderSetting = selected;
export const ewbProvider: EwbProvider | null = providers[selected]?.() ?? null;
if (!ewbProvider) {
  // Said once at start-up, in the function logs: e-way bills stay switched off until this is fixed.
  console.warn(selected === "gstinapi"
    ? "E-way bills are OFF: EWB_PROVIDER=gstinapi but GSTINAPI_KEY is empty in functions/.env."
    : `E-way bills are OFF: unknown EWB_PROVIDER "${selected}" (use gstinapi or sandbox).`);
}
