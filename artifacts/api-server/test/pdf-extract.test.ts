import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractInvoiceFields, type PdfRow } from "../src/lib/pdf-extract";

const row = (page: number, cells: [number, number, string][]): PdfRow => ({ page, cells: cells.map(([x, width, text]) => ({ x, width, text })) });
const textOf = (rows: PdfRow[]) => rows.map((item) => item.cells.map((cell) => cell.text).join(" ")).join("\n");

describe("PDF line items from the item table", () => {
  it("reads every product row, wrapped descriptions, units and rates, and stops at the totals", () => {
    const rows = [
      row(1, [[30, 200, "Tax Invoice"]]),
      row(1, [[30, 20, "Sl No."], [60, 100, "Description of Goods"], [250, 40, "HSN/SAC"], [300, 35, "GST Rate"], [345, 40, "Quantity"], [400, 25, "Rate"], [440, 15, "per"], [480, 40, "Amount"]]),
      row(1, [[32, 6, "1"], [60, 70, "MS Plate 10mm"], [250, 38, "72085110"], [305, 20, "18 %"], [340, 50, "1,000.000 kg"], [400, 25, "55.00"], [442, 10, "kg"], [475, 45, "55,000.00"]]),
      row(1, [[60, 60, "(Grade E250)"]]),
      row(1, [[32, 6, "2"], [60, 70, "MS Angle 50x50"], [250, 38, "72163100"], [305, 20, "18 %"], [345, 40, "500 Nos"], [398, 28, "120.00"], [442, 12, "Nos"], [475, 45, "60,000.00"]]),
      row(2, [[32, 6, "3"], [60, 70, "Binding Wire"], [250, 38, "7217"], [305, 20, "18 %"], [345, 40, "25 kg"], [400, 25, "80.00"], [442, 10, "kg"], [480, 40, "2,000.00"]]),
      row(2, [[60, 80, "Output IGST @18%"], [475, 45, "21,060.00"]]),
      row(2, [[60, 25, "Total"], [345, 40, "1,525"], [470, 50, "1,38,060.00"]]),
      row(2, [[60, 120, "Amount Chargeable (in words)"]]),
    ];
    const fields = extractInvoiceFields(textOf(rows), 2, rows);
    assert.equal(fields.lines.length, 3, JSON.stringify(fields.lines));
    assert.deepEqual(fields.lines[0], { description: "MS Plate 10mm (Grade E250)", hsn: "72085110", quantity: "1000", unit: "Kgs", unitPricePaise: 5500, taxablePaise: 5_500_000, taxRate: 18, confidence: "medium" });
    assert.equal(fields.lines[1]!.unit, "Nos");
    assert.equal(fields.lines[1]!.taxablePaise, 6_000_000);
    assert.equal(fields.lines[2]!.description, "Binding Wire");
    assert.equal(fields.lines[2]!.taxablePaise, 200_000);
  });

  it("reads the transporter's name from a label, on the same line or in the box below it", () => {
    const tally = [
      row(1, [[300, 80, "Dispatched through"], [420, 60, "Destination"]]),
      row(1, [[302, 90, "VRL Logistics Ltd"], [420, 50, "Surat"]]),
      row(1, [[300, 80, "Motor Vehicle No."]]),
      row(1, [[302, 70, "GJ05AB1234"]]),
    ];
    const fromTally = extractInvoiceFields(textOf(tally), 1, tally);
    assert.equal(fromTally.transporterName?.value, "VRL Logistics Ltd");
    assert.equal(fromTally.vehicleNumber?.value, "GJ05AB1234");
    const inline = [row(1, [[20, 200, "Transporter: Shree Roadways"], [300, 120, "LR No: 4521"]])];
    assert.equal(extractInvoiceFields(textOf(inline), 1, inline).transporterName?.value, "Shree Roadways");
    const nextCell = [row(1, [[20, 70, "Transporter Name"], [100, 100, "Om Sai Transport"], [300, 100, "Vehicle: MH12XY9876"]])];
    assert.equal(extractInvoiceFields(textOf(nextCell), 1, nextCell).transporterName?.value, "Om Sai Transport");
    // The transporter's GSTIN is not taken as the buyer's.
    const withId = [
      row(1, [[20, 200, "Seller GSTIN: 27AAPFU0939F1ZV"]]),
      row(1, [[20, 200, "Transporter: Shree Roadways"], [300, 200, "Transporter ID: 24AAACT2727Q1ZW"]]),
      row(1, [[20, 200, "Buyer GSTIN: 29AAGCR4375J1ZU"]]),
    ];
    const parsed = extractInvoiceFields(textOf(withId), 1, withId);
    assert.equal(parsed.transporterId?.value, "24AAACT2727Q1ZW");
    assert.equal(parsed.buyerGstin?.value, "29AAGCR4375J1ZU");
    assert.equal(parsed.transporterName?.value, "Shree Roadways");
    const none = [row(1, [[20, 70, "Dispatched through"]]), row(1, [[300, 50, "Destination"]])];
    assert.equal(extractInvoiceFields(textOf(none), 1, none).transporterName, undefined);
  });

  it("uses the invoice-wide GST rate and a taxable-value column when rows have no rate", () => {
    const rows = [
      row(1, [[20, 10, "#"], [40, 80, "Item"], [150, 30, "HSN"], [200, 25, "Qty"], [240, 60, "Taxable Value"], [320, 40, "Total"]]),
      ...Array.from({ length: 40 }, (_, index) => row(1, [[20, 10, String(index + 1)], [40, 80, `Product ${index + 1}`], [150, 30, "3926"], [205, 15, "2"], [250, 40, "100.00"], [320, 40, "105.00"]])),
      row(1, [[40, 60, "Sub Total"], [250, 40, "4,000.00"]]),
    ];
    const fields = extractInvoiceFields(`${textOf(rows)}\nCGST @ 2.5% 100.00\nSGST @ 2.5% 100.00`, 1, rows);
    assert.equal(fields.lines.length, 40);
    assert.equal(fields.lines[39]!.description, "Product 40");
    assert.equal(fields.lines[0]!.taxablePaise, 10_000);
    assert.equal(fields.lines[0]!.taxRate, 5);
  });
});
