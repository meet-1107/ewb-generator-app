import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractInvoiceFields, unspaceLetters, type PdfRow } from "../src/lib/pdf-extract";

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

  it("does not read transport details, and keeps the transporter's GSTIN out of the buyer", () => {
    const tally = [
      row(1, [[300, 80, "Dispatched through"], [420, 60, "Destination"]]),
      row(1, [[302, 90, "VRL Logistics Ltd"], [420, 50, "Surat"]]),
      row(1, [[300, 80, "Motor Vehicle No."]]),
      row(1, [[302, 70, "GJ05AB1234"]]),
    ];
    const fromTally = extractInvoiceFields(textOf(tally), 1, tally) as Record<string, unknown>;
    assert.equal(fromTally.transporterName, undefined);
    assert.equal(fromTally.vehicleNumber, undefined);
    assert.equal(fromTally.transporterId, undefined);
    const withId = [
      row(1, [[20, 200, "Seller GSTIN: 27AAPFU0939F1ZV"]]),
      row(1, [[20, 200, "Transporter: Shree Roadways"], [300, 200, "Transporter ID: 24AAACT2727Q1ZW"]]),
      row(1, [[20, 200, "Buyer GSTIN: 29AAGCR4375J1ZU"]]),
    ];
    assert.equal(extractInvoiceFields(textOf(withId), 1, withId).buyerGstin?.value, "29AAGCR4375J1ZU");
  });

  it("never takes the user's own GSTIN as the buyer's, wherever it is printed", () => {
    // Buyer block printed first, the user's GSTIN (seller) lower down.
    const rows = [
      row(1, [[20, 200, "Bill To: ATLANTIS AGRITECH PVT LTD"]]),
      row(1, [[20, 200, "GSTIN: 24AAGCP5430N1Z8"]]),
      row(1, [[20, 200, "Dispatch from our works"]]),
      row(1, [[20, 200, "Remarks"]]),
      row(1, [[20, 200, "Terms"]]),
      row(1, [[20, 200, "Supplier: IRON AGE INDUSTRIES GSTIN: 24CCNPR0179J1Z6"]]),
    ];
    const known = extractInvoiceFields(textOf(rows), 1, rows, ["24CCNPR0179J1Z6"]);
    assert.equal(known.sellerGstin?.value, "24CCNPR0179J1Z6");
    assert.equal(known.buyerGstin?.value, "24AAGCP5430N1Z8");
    // Only the user's own GSTIN on the PDF: no buyer GSTIN at all.
    const onlyOwn = [row(1, [[20, 200, "GSTIN: 24CCNPR0179J1Z6"]]), row(1, [[20, 200, "Bill To: Cash customer"]])];
    assert.equal(extractInvoiceFields(textOf(onlyOwn), 1, onlyOwn, ["24CCNPR0179J1Z6"]).buyerGstin, undefined);
    // Without the user's GSTINs (older app), the seller label decides.
    assert.equal(extractInvoiceFields(textOf(rows), 1, rows).buyerGstin?.value, "24AAGCP5430N1Z8");
  });

  it("takes an HSN printed just above or below its product's row", () => {
    // A debit memo whose HSN sits a little higher than the rest of the product row.
    const above = [
      row(1, [[35, 30, "SrNo"], [143, 80, "Product Name"], [305, 50, "HSN/SAC"], [368, 20, "Qty"], [419, 25, "Rate"], [515, 40, "Amount"]]),
      row(1, [[464, 30, "GST %"]]),
      row(1, [[305, 50, "72044100"]]),
      row(1, [[53, 40, "1 WASTE"], [95, 60, "AND SCRAP"], [359, 45, "9395.000"], [435, 25, "29.00"], [470, 25, "18.00"], [523, 45, "272455.00"]]),
      row(1, [[407, 50, "Sub Total"], [517, 45, "272455.00"]]),
    ];
    const memo = extractInvoiceFields(textOf(above), 1, above).lines;
    assert.equal(memo.length, 1, JSON.stringify(memo));
    assert.equal(memo[0]!.description, "WASTE AND SCRAP");
    assert.equal(memo[0]!.hsn, "72044100");
    assert.equal(memo[0]!.quantity, "9395");
    assert.equal(memo[0]!.taxablePaise, 27_245_500);
    // The same table with each HSN a little lower than its product.
    const below = [
      row(1, [[35, 30, "SrNo"], [143, 80, "Product Name"], [305, 50, "HSN/SAC"], [368, 20, "Qty"], [419, 25, "Rate"], [515, 40, "Amount"]]),
      row(1, [[53, 40, "1 MS Plate"], [359, 45, "10"], [435, 25, "50.00"], [523, 45, "500.00"]]),
      row(1, [[305, 50, "7208"]]),
      row(1, [[53, 40, "2 MS Angle"], [359, 45, "5"], [435, 25, "40.00"], [523, 45, "200.00"]]),
      row(1, [[305, 50, "7216"]]),
      row(1, [[407, 50, "Sub Total"], [517, 45, "700.00"]]),
    ];
    assert.deepEqual(extractInvoiceFields(textOf(below), 1, below).lines.map((line) => line.hsn), ["7208", "7216"]);
  });

  it("does not read the HSN code as the quantity", () => {
    // HSN header split over two lines, and the code printed nearer to Qty.
    const split = [
      row(1, [[20, 20, "Sr"], [50, 100, "Description of Goods"], [215, 30, "HSN/"], [260, 40, "Quantity"], [320, 30, "Rate"], [400, 40, "Amount"]]),
      row(1, [[215, 30, "SAC"]]),
      row(1, [[22, 6, "1"], [50, 90, "R. D. SHAFT SEMI 10T"], [240, 30, "998898"], [262, 30, "55 Nos"], [320, 30, "50.00"], [400, 40, "2,750.00"]]),
      row(1, [[50, 25, "Total"], [400, 40, "2,750.00"]]),
    ];
    const first = extractInvoiceFields(textOf(split), 1, split).lines[0]!;
    assert.equal(first.hsn, "998898");
    assert.equal(first.quantity, "55");
    // No HSN column: the code sits in the Qty column ahead of the quantity.
    const noColumn = [
      row(1, [[20, 20, "Sr"], [50, 100, "Particulars"], [260, 40, "Qty"], [320, 30, "Rate"], [400, 40, "Amount"]]),
      row(1, [[22, 6, "1"], [50, 90, "Dosa Tawa"], [250, 30, "73239110"], [285, 20, "10"], [320, 30, "399.00"], [400, 40, "3,990.00"]]),
    ];
    const second = extractInvoiceFields(textOf(noColumn), 1, noColumn).lines[0]!;
    assert.equal(second.hsn, "73239110");
    assert.equal(second.quantity, "10");
  });

  it("reads a bill with ORIGINAL FOR RECIPIENT, side-by-side Bill To / Ship To and an Amount that includes tax", () => {
    const rows = [
      row(1, [[28, 59, "TAX INVOICE"], [98, 119, "ORIGINAL FOR RECIPIENT"]]),
      row(1, [[33, 207, "SHIVAM ENTERPRISE"]]),
      row(1, [[33, 349, "CHANDRASNAGAR MAIN ROAD, NEW ASHAPURA PARK,, Rajkot, Gujarat, 360002"]]),
      row(1, [[33, 32, "Mobile:"], [70, 55, "9825771419"], [143, 31, "GSTIN:"], [178, 82, "24BILPG8938F1Z1"]]),
      row(1, [[42, 56, "Invoice No.:"], [102, 12, "45"], [432, 61, "Invoice Date:"], [498, 56, "29/09/2026"]]),
      row(1, [[30, 39, "BILL TO"], [298, 42, "SHIP TO"]]),
      row(1, [[30, 152, "ATLANTIS AGRITECH PVT LTD"], [298, 152, "ATLANTIS AGRITECH PVT LTD"]]),
      row(1, [[30, 100, "Rajkot, Gujarat, 360024"], [298, 100, "Rajkot, Gujarat, 360024"]]),
      row(1, [[30, 91, "Mobile: 7698400580"]]),
      row(1, [[30, 30, "GSTIN:"], [71, 88, "24AAGCP5430N1Z8"]]),
      row(1, [[36, 31, "ITEMS"], [220, 21, "HSN"], [294, 22, "QTY."], [348, 25, "RATE"], [443, 20, "TAX"], [515, 44, "AMOUNT"]]),
      row(1, [[36, 98, "R. D. SHAFT SEMI 10T"], [220, 22, "9988"], [279, 37, "234 PCS"], [363, 11, "43"], [425, 37, "1,811.16"], [517, 43, "11,873.16"]]),
      row(1, [[443, 19, "(18%)"]]),
      row(1, [[36, 48, "SUBTOTAL"], [299, 17, "234"], [424, 39, "1,811.16"], [515, 44, "11,873.16"]]),
      row(1, [[426, 48, "CGST @9%"], [535, 30, "905.58"]]),
      row(1, [[416, 59, "Total Amount"], [527, 5, "₹"], [534, 30, "11,873"]]),
      row(1, [[455, 105, "Total Amount (in words)"]]),
      row(1, [[35, 179, "1 Goods once sold will not be taken back."]]),
    ];
    const fields = extractInvoiceFields(textOf(rows), 1, rows, ["24CCNPR0179J1Z6"]);
    assert.equal(fields.buyerGstin?.value, "24AAGCP5430N1Z8");
    assert.equal(fields.buyerName?.value, "ATLANTIS AGRITECH PVT LTD");
    assert.equal(fields.buyerPincode?.value, "360024");
    assert.equal(fields.sellerGstin?.value, "24BILPG8938F1Z1");
    assert.equal(fields.sellerName?.value, "SHIVAM ENTERPRISE");
    assert.deepEqual(fields.lines.map((line) => [line.hsn, line.quantity, line.taxRate, line.taxablePaise]), [["9988", "234", 18, 1_006_200]]);
    assert.equal(fields.taxablePaise?.value, 1_006_200);
    assert.equal(fields.totalPaise?.value, 1_187_300);
  });

  it("takes a PIN code that belongs to the party's state, and skips other 6-digit numbers", () => {
    const rows = [
      row(1, [[20, 200, "Bill To: ROYAL ENTERPRISE"]]),
      row(1, [[20, 200, "Ref 272455"]]),
      row(1, [[20, 200, "Station Road, Junagadh - 362001"]]),
      row(1, [[20, 200, "GSTIN: 24ABIFR9607F1Z2"]]),
    ];
    assert.deepEqual(extractInvoiceFields(textOf(rows), 1, rows, ["27AAPFU0939F1ZV"]).buyerPincode, { value: "362001", confidence: "high" });
    // Only a number that cannot be a Gujarat PIN: leave the PIN empty instead of a wrong one.
    const wrong = [row(1, [[20, 200, "Bill To: ROYAL ENTERPRISE 272455"]]), row(1, [[20, 200, "GSTIN: 24ABIFR9607F1Z2"]])];
    assert.equal(extractInvoiceFields(textOf(wrong), 1, wrong, ["27AAPFU0939F1ZV"]).buyerPincode, undefined);
  });

  it("splits HSN and Qty printed as one text, and reads CGST + SGST rates per row (Sale bill layout)", () => {
    const rows = [
      row(1, [[30, 133, "Details of Receiver (Billed to)"]]),
      row(1, [[30, 27, "M/s. :"]]),
      row(1, [[68, 157, "RUDRAKSH CONSTRUCTION"]]),
      row(1, [[30, 25, "Add. :"], [68, 45, "JUNAGADH"]]),
      row(1, [[30, 35, "GSTIN :"], [68, 75, "24ABIFR9607F1Z2"], [182, 67, "State : Gujarat"]]),
      row(1, [[31, 13, "Sr."], [57, 64, "Product Name"], [152, 17, "HSN"], [179, 16, "Qty"], [213, 21, "Rate"], [258, 23, "Total"]]),
      row(1, [[44, 4, "1"], [53, 89, "25MM POLYCAB LMS PVC"], [154, 49, "3917 700.000"], [225, 20, "65.00"], [260, 34, "45500.00"], [354, 17, "9.0%"], [390, 26, "4095.00"], [436, 17, "9.0%"], [466, 26, "4095.00"]]),
      row(1, [[44, 4, "2"], [53, 49, "JK 750 VOLTE"], [154, 18, "8541"], [182, 20, "1.000"], [216, 29, "7500.00"], [265, 29, "7500.00"], [354, 17, "2.5%"], [394, 22, "187.50"], [436, 17, "2.5%"], [470, 22, "187.50"]]),
      row(1, [[39, 9, "3"], [53, 64, "JAQ AREVA PRIME"], [123, 16, "15W"], [154, 18, "9405"], [178, 25, "20.000"], [221, 25, "610.00"], [260, 34, "12200.00"], [354, 17, "9.0%"], [436, 17, "9.0%"]]),
      row(1, [[75, 39, "Sub Total :"], [164, 34, "721.000"], [234, 38, "65200.00"]]),
      row(1, [[35, 47, "GSTIN No."], [86, 3, ":"], [98, 76, "24BPAPP7025L1ZS"]]),
    ];
    const fields = extractInvoiceFields(textOf(rows), 1, rows, ["24CCNPR0179J1Z6"]);
    assert.deepEqual(fields.lines.map((line) => [line.description, line.hsn, line.quantity, line.taxRate, line.taxablePaise]), [
      ["25MM POLYCAB LMS PVC", "3917", "700", 18, 4_550_000],
      ["JK 750 VOLTE", "8541", "1", 5, 750_000],
      ["JAQ AREVA PRIME 15W", "9405", "20", 18, 1_220_000],
    ]);
    assert.equal(fields.buyerGstin?.value, "24ABIFR9607F1Z2");
    assert.equal(fields.buyerName?.value, "RUDRAKSH CONSTRUCTION");
    assert.equal(fields.taxablePaise?.value, 6_520_000);
    // An older app sends no GSTINs: the seller's GSTIN at the bottom still is not the buyer's.
    assert.equal(extractInvoiceFields(textOf(rows), 1, rows).buyerGstin?.value, "24ABIFR9607F1Z2");
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

describe("PDF fields from letter-spaced and unlabelled layouts", () => {
  // The app's own printed invoice: letter-spaced labels, the number and date at the top right without labels.
  const printed = [
    row(1, [[535, 49, "TAX INVOICE"]]),
    row(1, [[21, 144, "ASIAN POLY PLAST"]]),
    row(1, [[21, 339, "SURVEY NO 124, MORBI ROAD, Hadala"], [585, 6, "2"]]),
    row(1, [[21, 175, "Gujarat 360003 · GSTIN 24ABAFA4878K1Z9"]]),
    row(1, [[542, 49, "25 Oct 2026"]]),
    row(1, [[31, 28, "B I L L TO"], [322, 30, "S H I P TO"]]),
    row(1, [[31, 93, "IRON AGE INDUSTRIES"], [322, 93, "IRON AGE INDUSTRIES"]]),
    row(1, [[31, 61, "Gujarat 360022"], [322, 61, "Gujarat 360022"]]),
    row(1, [[31, 28, "GSTIN:"], [61, 81, "24CCNPR0179J1Z6"], [322, 28, "GSTIN:"], [352, 81, "24CCNPR0179J1Z6"]]),
    row(1, [[27, 4, "#"], [54, 52, "DESCRIPTION"], [179, 16, "HSN"], [281, 15, "QTY"], [345, 19, "RATE"], [418, 34, "TAXABLE"], [482, 15, "GST"], [551, 33, "AMOUNT"]]),
    row(1, [[27, 5, "1"], [54, 56, "Brass Elbow 1"], [179, 20, "7881"], [263, 34, "100 Nos"], [338, 27, "₹10.00"], [414, 39, "₹1,000.00"], [481, 17, "18%"], [546, 39, "₹1,180.00"]]),
    row(1, [[27, 5, "2"], [54, 69, "2 Cocealed Valve"], [179, 20, "7881"], [263, 34, "100 Nos"], [333, 32, "₹300.00"], [409, 44, "₹30,000.00"], [481, 17, "18%"], [541, 44, "₹35,400.00"]]),
    row(1, [[21, 72, "A M O U NT I N W O R D S"]]),
    row(1, [[21, 190, "Thirty Six Thousand Five Hundred Eighty Rupees Only"]]),
    row(1, [[318, 54, "Taxable value"], [541, 44, "₹31,000.00"]]),
  ];

  it("does not add the amount in words to the last product", () => {
    const fields = extractInvoiceFields(textOf(printed), 1, printed);
    assert.equal(fields.lines.length, 2);
    assert.equal(fields.lines[1]!.description, "2 Cocealed Valve");
  });

  it("reads the number and date printed without labels, and the name under a letter-spaced BILL TO", () => {
    const fields = extractInvoiceFields(textOf(printed), 1, printed);
    assert.deepEqual(fields.invoiceNumber, { value: "2", confidence: "low" });
    assert.equal(fields.invoiceDate?.value, "2026-10-25");
    assert.equal(fields.buyerName?.value, "IRON AGE INDUSTRIES");
  });

  it("stops the table at an amount in words even without its label", () => {
    const rows = [printed[9]!, printed[10]!, row(1, [[54, 190, "One Thousand One Hundred Eighty Rupees Only"]])];
    assert.equal(extractInvoiceFields(textOf(rows), 1, rows).lines[0]!.description, "Brass Elbow 1");
  });

  it("keeps the invoice number box out of an M/s. name on the same line", () => {
    const rows = [
      row(1, [[222, 151, "J. K. INDUSTRIES"]]),
      row(1, [[33, 27, "M/s. :"], [69, 101, "ROYAL ENTERPRISE"], [350, 51, "Invoice No."], [413, 3, ":"], [425, 6, "5"]]),
      row(1, [[350, 21, "Date"], [413, 3, ":"], [425, 56, "21/08/2026"]]),
      row(1, [[34, 43, "GSTIN No."], [95, 3, ":"]]),
      row(1, [[104, 79, "24AHVPA6592R1ZE"]]),
      row(1, [[35, 56, "GSTIN No.:"], [96, 95, "24CRIPP6801K1ZJ"]]),
    ];
    const fields = extractInvoiceFields(textOf(rows), 1, rows);
    assert.equal(fields.buyerName?.value, "ROYAL ENTERPRISE");
    assert.equal(fields.invoiceNumber?.value, "5");
  });

  it("joins letter-spaced labels and leaves short names alone", () => {
    assert.equal(unspaceLetters("A M O U NT I N W O R D S"), "AMOUNT IN WORDS");
    assert.equal(unspaceLetters("B I L L TO S H I P TO"), "BILL TO SHIP TO");
    assert.equal(unspaceLetters("J K INDUSTRIES"), "J K INDUSTRIES");
  });
});
