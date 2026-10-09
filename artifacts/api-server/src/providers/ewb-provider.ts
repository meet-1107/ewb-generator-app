import { randomInt } from "node:crypto";
import { computeValidity, validateEwb, type EwbInput, type FieldIssue } from "../lib/validation";

/**
 * Provider adapter boundary. Screens and routes only see these normalized
 * shapes; a real GSP / NIC integration implements the same interface and is
 * selected with EWB_PROVIDER. Credentials stay in server-side secrets.
 */

export type GenerateResult =
  | { ok: true; providerBillId: string; ewbNumber: string; generatedAt: Date; validUntil: Date; validityDays: number; partBPending: boolean }
  | { ok: false; code: string; message: string; issues: FieldIssue[] };

export type ActionResult = { ok: true; validUntil?: Date } | { ok: false; code: string; message: string };

export interface EwbProvider {
  readonly id: string;
  readonly label: string;
  readonly sandbox: boolean;
  validate(input: EwbInput): { issues: FieldIssue[]; warnings: string[] };
  generate(input: EwbInput): Promise<GenerateResult>;
  extend(args: { validUntil: Date; distanceKm: number; remainingKm: number; reason: string }): Promise<ActionResult>;
  cancel(args: { generatedAt: Date; reason: string }): Promise<ActionResult>;
  updateVehicle(args: { vehicleNumber: string; reason: string }): Promise<ActionResult>;
}

const latency = () => new Promise((resolve) => setTimeout(resolve, 350 + randomInt(400)));

class SandboxEwbProvider implements EwbProvider {
  readonly id = "sandbox";
  readonly label = "Sandbox provider (test only — not sent to NIC)";
  readonly sandbox = true;

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
    if (!/^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/.test(vehicleNumber)) {
      return { ok: false, code: "VEHICLE_FORMAT", message: "Vehicle number format looks wrong (example: MH12AB1234)." };
    }
    if (!reason.trim()) return { ok: false, code: "REASON_REQUIRED", message: "Choose a reason for the vehicle change." };
    return { ok: true };
  }
}

const providers: Record<string, () => EwbProvider> = {
  sandbox: () => new SandboxEwbProvider(),
};

const selected = process.env["EWB_PROVIDER"] ?? "sandbox";
export const ewbProvider: EwbProvider | null = providers[selected]?.() ?? null;
