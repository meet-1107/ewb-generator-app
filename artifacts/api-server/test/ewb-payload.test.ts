import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildGeneratePayload } from "../src/providers/gstinapi-ewb-provider";

const base = {
  invoiceId: "inv1",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-10-11",
  documentType: "Tax invoice",
  supplyType: "inter",
  seller: { name: "Shree Traders", gstin: "27AAPFU0939F1ZV", address: "Pune", state: "Maharashtra", pincode: "411001" },
  buyer: { name: "Krishna Steels", gstin: "24AAACR5055K1ZD", address: "Ahmedabad", state: "Gujarat", pincode: "382445" },
  lines: [{ description: "Steel coil", hsn: "7208", quantity: "10", unit: "Nos", taxablePaise: 25_000_000, taxRate: 18 }],
  totals: { taxable: 25_000_000, tax: 4_500_000, total: 29_500_000 },
};
const payload = (transport: Record<string, string>) =>
  buildGeneratePayload({ ...base, transport: { transporterName: "", transporterId: "", vehicleNumber: "", mode: "Road", distanceKm: "700", ...transport } } as never);

describe("NIC generate payload: Part-B", () => {
  it("leaves the mode and vehicle blank when only the transporter ID is given", () => {
    const body = payload({ transporterId: "24AAACR5055K1ZD", transporterName: "Fast Movers" });
    assert.equal(body.transporterId, "24AAACR5055K1ZD");
    assert.equal(body.transMode, "");
    assert.equal(body.vehicleNo, "");
    assert.equal("vehicleType" in body, false);
  });

  it("sends road mode, a cleaned vehicle number and the vehicle type when the vehicle is given", () => {
    const body = payload({ vehicleNumber: "mh12 ab-1234" });
    assert.equal(body.transMode, "1");
    assert.equal(body.vehicleNo, "MH12AB1234");
    assert.equal(body.vehicleType, "R");
  });

  it("sends the transport document for rail", () => {
    const body = payload({ mode: "Rail", docNumber: "RR123", docDate: "2026-10-11" });
    assert.equal(body.transMode, "2");
    assert.equal(body.transDocNo, "RR123");
    assert.equal(body.transDocDate, "11/10/2026");
  });
});
