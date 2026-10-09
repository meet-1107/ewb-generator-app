import { createHash } from "node:crypto";
import type { GstSnapshot } from "../lib/store";

/**
 * GST return status adapter. The sandbox derives a stable, clearly-labelled
 * test status from the GSTIN + period so the UI can be exercised end to end.
 * A real GSP adapter replaces `fetchStatus`; the app never collects GST
 * portal passwords or OTPs.
 */

export interface GstProvider {
  readonly id: string;
  readonly label: string;
  readonly sandbox: boolean;
  fetchStatus(gstin: string, period: string): Promise<Omit<GstSnapshot, "id" | "checkedAt">[]>;
}

function dueDate(period: string, day: number) {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

class SandboxGstProvider implements GstProvider {
  readonly id = "sandbox";
  readonly label = "Sandbox GST provider (test data)";
  readonly sandbox = true;

  async fetchStatus(gstin: string, period: string) {
    const seed = createHash("sha256").update(`${gstin}:${period}`).digest();
    const today = new Date().toISOString().slice(0, 10);
    const returns = [
      { returnType: "GSTR-1" as const, due: dueDate(period, 11) },
      { returnType: "GSTR-2B" as const, due: dueDate(period, 14) },
      { returnType: "GSTR-3B" as const, due: dueDate(period, 20) },
    ];
    return returns.map(({ returnType, due }, index) => {
      const pastDue = today > due;
      const roll = seed[index]! % 10;
      let providerStatus: GstSnapshot["providerStatus"];
      if (returnType === "GSTR-2B") providerStatus = today >= due ? "filed" : "not_available";
      else if (pastDue) providerStatus = roll < 8 ? "filed" : "not_filed";
      else providerStatus = roll < 3 ? "filed" : roll < 5 ? "in_progress" : "not_filed";
      const filedOn = providerStatus === "filed"
        ? new Date(Math.min(Date.parse(due) - (seed[index + 3]! % 5) * 86_400_000, Date.now())).toISOString().slice(0, 10)
        : undefined;
      return {
        gstin,
        returnType,
        period,
        providerStatus,
        filedOn,
        dueDate: due,
        arn: providerStatus === "filed" && returnType !== "GSTR-2B" ? `AA${gstin.slice(0, 2)}${seed.readUInt32BE(8).toString().padStart(10, "0")}` : undefined,
        source: this.label,
      };
    });
  }
}

const selected = process.env["GST_PROVIDER"] ?? "sandbox";
export const gstProvider: GstProvider | null = selected === "sandbox" ? new SandboxGstProvider() : null;
