/**
 * Shared GST / e-way bill validation rules used by the trusted backend.
 * The mobile client runs a copy of the basic checks for fast feedback, but
 * the backend result is the final authority before any provider call.
 */

export const STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_SHAPE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/;

export function stateFromName(name: string) {
  const clean = name.trim().toLowerCase();
  return STATES.find((state) => state.name.toLowerCase() === clean || state.code === clean);
}

export function gstinChecksumOk(gstin: string) {
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = GSTIN_CHARS.indexOf(gstin[index]!);
    if (value < 0) return false;
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
}

/** Returns an error message, or null when the GSTIN passes format + checksum. */
export function gstinProblem(raw: string) {
  const gstin = raw.trim().toUpperCase();
  if (!GSTIN_SHAPE.test(gstin)) return "GSTIN must be 15 characters in the format 22AAAAA0000A1Z5.";
  if (!STATES.some((state) => state.code === gstin.slice(0, 2))) return "GSTIN starts with an unknown state code.";
  if (!gstinChecksumOk(gstin)) return "GSTIN check digit does not match. Re-check each character.";
  return null;
}

export const VEHICLE_PATTERN = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2}|TR[A-Z0-9]{6,12})$/;

export type FieldIssue = { field: string; section: "seller" | "buyer" | "invoice" | "items" | "transport"; message: string };

export type EwbInput = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  documentType: string;
  supplyType: "intra" | "inter";
  seller: { name: string; gstin: string; address: string; state: string; pincode: string };
  buyer: { name: string; gstin: string; address: string; state: string; pincode: string };
  lines: { description: string; hsn: string; quantity: string; unit: string; taxablePaise: number; taxRate: number }[];
  transport: {
    transporterName: string;
    transporterId: string;
    vehicleNumber: string;
    mode: string;
    distanceKm: string;
    docNumber?: string;
    docDate?: string;
    vehicleType?: "regular" | "odc";
  };
  totals: { taxable: number; tax: number; total: number };
};

export function computeTotals(input: Pick<EwbInput, "lines">) {
  const taxable = input.lines.reduce((sum, line) => sum + line.taxablePaise, 0);
  const tax = input.lines.reduce((sum, line) => sum + Math.round((line.taxablePaise * line.taxRate) / 100), 0);
  return { taxable, tax, total: taxable + tax };
}

/** Validates an e-way bill request using the rules the sandbox provider enforces. */
export function validateEwb(input: EwbInput, now = new Date()): { issues: FieldIssue[]; warnings: string[] } {
  const issues: FieldIssue[] = [];
  const warnings: string[] = [];
  const push = (section: FieldIssue["section"], field: string, message: string) => issues.push({ section, field, message });

  if (!input.seller.name.trim()) push("seller", "sellerName", "Seller name is required.");
  const sellerGstinIssue = gstinProblem(input.seller.gstin);
  if (sellerGstinIssue) push("seller", "sellerGstin", sellerGstinIssue);
  if (!/^[1-9]\d{5}$/.test(input.seller.pincode.trim())) push("seller", "sellerPincode", "Seller PIN code must be 6 digits.");
  const sellerState = stateFromName(input.seller.state);
  if (!sellerState) push("seller", "sellerState", "Choose the seller state from the list.");
  else if (!sellerGstinIssue && input.seller.gstin.slice(0, 2) !== sellerState.code) {
    push("seller", "sellerState", `Seller GSTIN is registered in state code ${input.seller.gstin.slice(0, 2)}, not ${sellerState.name}.`);
  }

  if (!input.buyer.name.trim()) push("buyer", "buyerName", "Receiver name is required.");
  if (input.buyer.gstin.trim() && input.buyer.gstin.trim().toUpperCase() !== "URP") {
    const buyerIssue = gstinProblem(input.buyer.gstin);
    if (buyerIssue) push("buyer", "buyerGstin", buyerIssue);
  }
  if (!/^[1-9]\d{5}$/.test(input.buyer.pincode.trim())) push("buyer", "buyerPincode", "Receiver PIN code must be 6 digits.");
  const buyerState = stateFromName(input.buyer.state);
  if (!buyerState) push("buyer", "buyerState", "Choose the receiver state from the list.");
  if (sellerState && buyerState) {
    const expected = sellerState.code === buyerState.code ? "intra" : "inter";
    if (expected !== input.supplyType) {
      push("invoice", "supplyType", expected === "intra"
        ? "Seller and receiver are in the same state, so supply must be within state (CGST + SGST)."
        : "Seller and receiver are in different states, so supply must be inter-state (IGST).");
    }
  }

  if (!input.invoiceNumber.trim()) push("invoice", "invoiceNumber", "Invoice number is required.");
  else if (!/^[A-Za-z0-9/-]{1,16}$/.test(input.invoiceNumber.trim())) {
    push("invoice", "invoiceNumber", "Document number may use up to 16 letters, digits, / and - only.");
  }
  const date = new Date(`${input.invoiceDate}T00:00:00+05:30`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate) || Number.isNaN(date.getTime())) {
    push("invoice", "invoiceDate", "Invoice date must be a valid date.");
  } else if (date.getTime() > now.getTime() + 86_400_000) {
    push("invoice", "invoiceDate", "Invoice date cannot be in the future.");
  } else if (now.getTime() - date.getTime() > 180 * 86_400_000) {
    warnings.push("Invoice is older than 180 days. Confirm the document date with your provider.");
  }

  const describedLines = input.lines.filter((line) => line.description.trim() && line.taxablePaise > 0);
  if (!describedLines.length) push("items", "lines", "Add at least one product with a taxable value.");
  input.lines.forEach((line, index) => {
    if (!line.description.trim() && line.taxablePaise === 0) return;
    if (!/^\d{4}(\d{2})?(\d{2})?$/.test(line.hsn.trim())) push("items", `lines.${index}.hsn`, `Line ${index + 1}: HSN must be 4, 6 or 8 digits.`);
    if (!(Number(line.quantity) > 0)) push("items", `lines.${index}.quantity`, `Line ${index + 1}: quantity must be more than zero.`);
  });

  const totals = computeTotals(input);
  if (totals.total !== input.totals.total) push("items", "totals", "Totals changed since review. Re-open the invoice to recalculate.");
  if (totals.total < 50_000_00) warnings.push("Consignment value is below ₹50,000. An e-way bill is generally optional here, but you may still generate one.");

  const distance = Number(input.transport.distanceKm);
  if (!Number.isInteger(distance) || distance < 1 || distance > 4000) push("transport", "distanceKm", "Distance must be a whole number between 1 and 4000 km.");
  const mode = input.transport.mode;
  if (!["Road", "Rail", "Air", "Ship"].includes(mode)) push("transport", "transportMode", "Choose a transport mode.");
  const vehicle = input.transport.vehicleNumber.replace(/\s/g, "").toUpperCase();
  if (input.transport.transporterId.trim()) {
    const issue = gstinProblem(input.transport.transporterId);
    if (issue) push("transport", "transporterId", `Transporter ID: ${issue}`);
  }
  if (mode === "Road") {
    if (!vehicle && !input.transport.transporterId.trim()) {
      push("transport", "vehicleNumber", "For road transport, add a vehicle number or a transporter ID.");
    } else if (vehicle && !VEHICLE_PATTERN.test(vehicle)) {
      push("transport", "vehicleNumber", "Vehicle number format looks wrong (example: MH12AB1234).");
    }
  } else if (mode) {
    if (!input.transport.docNumber?.trim()) push("transport", "transportDocNo", `${mode} transport needs a transport document number.`);
    if (!input.transport.docDate?.trim()) push("transport", "transportDocDate", `${mode} transport needs a transport document date.`);
  }

  return { issues, warnings };
}

/** Validity per CGST rule 138(10): 1 day per 200 km (20 km for over-dimensional cargo), ending at midnight IST. */
export function computeValidity(generatedAt: Date, distanceKm: number, vehicleType: "regular" | "odc" = "regular") {
  const per = vehicleType === "odc" ? 20 : 200;
  const days = Math.max(1, Math.ceil(distanceKm / per));
  const istOffset = 5.5 * 3_600_000;
  const ist = new Date(generatedAt.getTime() + istOffset);
  const endIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, 23, 59, 59);
  return { days, validUntil: new Date(endIst - istOffset) };
}
