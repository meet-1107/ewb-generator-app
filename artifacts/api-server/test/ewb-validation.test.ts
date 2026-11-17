import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { validateEwb } from "../src/lib/validation";

const base = {
  invoiceId: "inv1",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-11-18",
  documentType: "Tax invoice",
  supplyType: "inter",
  seller: { name: "Shree Traders", gstin: "27AAPFU0939F1ZV", address: "Pune", state: "Maharashtra", pincode: "411001" },
  buyer: { name: "Krishna Steels", gstin: "24AAACR5055K1ZD", address: "Ahmedabad", state: "Gujarat", pincode: "382445" },
  lines: [{ description: "Steel coil", hsn: "7208", quantity: "10", unit: "Nos", taxablePaise: 999_950, taxRate: 18 }],
  totals: { taxable: 999_950, tax: 179_991, total: 1_179_941 },
  transport: { transporterName: "", transporterId: "", vehicleNumber: "MH12AB1234", mode: "Road", distanceKm: "700" },
};
const now = new Date("2026-11-18T04:30:00Z"); // 10:00 India time
const fields = (input: unknown) => validateEwb(input as never, now).issues.map((issue) => issue.field);

describe("e-way bill validation", () => {
  it("accepts a total rounded to the rupee (the round off)", () => {
    assert.ok(!fields({ ...base, totals: { ...base.totals, total: 1_179_900 } }).includes("totals"));
    assert.ok(!fields(base).includes("totals"));
  });

  it("still refuses totals that changed by more than a rupee", () => {
    assert.ok(fields({ ...base, totals: { ...base.totals, total: 1_179_700 } }).includes("totals"));
  });

  it("refuses tomorrow's date in India time", () => {
    assert.ok(fields({ ...base, invoiceDate: "2026-11-19" }).includes("invoiceDate"));
    assert.ok(!fields(base).includes("invoiceDate"));
  });

  it("asks for the name of a priced line", () => {
    const lines = [...base.lines, { description: "", hsn: "7208", quantity: "1", unit: "Nos", taxablePaise: 10_000, taxRate: 18 }];
    assert.ok(fields({ ...base, lines, totals: { taxable: 1_009_950, tax: 181_791, total: 1_191_741 } }).includes("lines.1.description"));
  });
});
