import { STATES, gstinChecksumOk, stateFromName } from "./validation";

/**
 * Turns invoice PDF text into candidate fields. Every value is a suggestion
 * with a confidence level; the client must have the user confirm each one.
 */

export type Confidence = "high" | "medium" | "low";
export type Candidate<T = string> = { value: T; confidence: Confidence };
export type ExtractedInvoice = {
  invoiceNumber?: Candidate;
  invoiceDate?: Candidate;
  sellerName?: Candidate;
  sellerGstin?: Candidate;
  sellerState?: Candidate;
  sellerPincode?: Candidate;
  buyerName?: Candidate;
  buyerGstin?: Candidate;
  buyerState?: Candidate;
  buyerPincode?: Candidate;
  vehicleNumber?: Candidate;
  totalPaise?: Candidate<number>;
  taxablePaise?: Candidate<number>;
  lines: { description: string; hsn: string; quantity: string; taxablePaise: number; taxRate: number; confidence: Confidence }[];
  pageCount: number;
  characters: number;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function toIsoDate(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  let match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(text);
  if (match) {
    const [, d, m, y] = match;
    const year = y!.length === 2 ? `20${y}` : y!;
    return valid(`${year}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`);
  }
  match = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(text);
  if (match) return valid(`${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`);
  match = /^(\d{1,2})[\s-]*([a-z]{3})[a-z]*[\s,-]*(\d{2,4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[2]!) + 1;
    if (!month) return null;
    const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
    return valid(`${year}-${String(month).padStart(2, "0")}-${match[1]!.padStart(2, "0")}`);
  }
  return null;
}

function valid(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function toPaise(raw: string) {
  const value = Number(raw.replace(/[,₹\s]|rs\.?|inr/gi, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

const AMOUNT = String.raw`(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*\.?[0-9]{0,2})`;

function amountAfter(text: string, labels: string[]) {
  for (const label of labels) {
    const regex = new RegExp(`${label}[^0-9₹\\n]{0,30}${AMOUNT}`, "gi");
    let last: number | null = null;
    for (const match of text.matchAll(regex)) {
      const paise = toPaise(match[1]!);
      if (paise) last = paise;
    }
    if (last) return last;
  }
  return null;
}

function nameNear(lines: string[], index: number) {
  for (let offset = -3; offset <= 3; offset += 1) {
    const line = lines[index + offset]?.trim() ?? "";
    if (
      line.length > 3 &&
      line.length < 70 &&
      /[a-z]/i.test(line) &&
      !/gstin|gst no|invoice|date|state|address|phone|email|pin|tax|bill to|ship to|sold by|buyer|seller|consignee|consignor/i.test(line) &&
      /(pvt|private|ltd|limited|llp|enterprises|traders|industries|company|co\.|corporation|agency|stores|mart|&)/i.test(line)
    ) {
      return line.replace(/^(m\/s\.?|name:?)\s*/i, "");
    }
  }
  return null;
}

function stateNear(lines: string[], index: number) {
  for (let offset = 0; offset <= 6; offset += 1) {
    const line = (lines[index + offset] ?? "").toLowerCase();
    const found = STATES.find((state) => line.includes(state.name.toLowerCase()));
    if (found) return found.name;
  }
  return null;
}

function pinNear(lines: string[], index: number) {
  for (let offset = -4; offset <= 6; offset += 1) {
    const match = /\b([1-9]\d{2}\s?\d{3})\b/.exec(lines[index + offset] ?? "");
    if (match && !/gstin|invoice|phone|mobile|hsn/i.test(lines[index + offset] ?? "")) return match[1]!.replace(/\s/g, "");
  }
  return null;
}

export function extractInvoiceFields(text: string, pageCount: number): ExtractedInvoice {
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const result: ExtractedInvoice = { lines: [], pageCount, characters: normalized.length };

  // GSTINs in reading order: first is usually the seller, the next distinct one the buyer.
  const gstins: { value: string; line: number; checksum: boolean }[] = [];
  lines.forEach((line, index) => {
    for (const match of line.toUpperCase().matchAll(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/g)) {
      if (!gstins.some((item) => item.value === match[1])) gstins.push({ value: match[1]!, line: index, checksum: gstinChecksumOk(match[1]!) });
    }
  });
  const sellerIndex = gstins.findIndex((item) => /sold by|seller|supplier|from|consignor/i.test(lines.slice(Math.max(0, item.line - 4), item.line + 1).join(" ")));
  const seller = gstins[sellerIndex >= 0 ? sellerIndex : 0];
  const buyer = gstins.find((item) => item !== seller);
  if (seller) {
    result.sellerGstin = { value: seller.value, confidence: seller.checksum ? "high" : "low" };
    const name = nameNear(lines, seller.line);
    if (name) result.sellerName = { value: name, confidence: "medium" };
    const state = STATES.find((item) => item.code === seller.value.slice(0, 2))?.name ?? stateNear(lines, seller.line);
    if (state) result.sellerState = { value: state, confidence: "high" };
    const pin = pinNear(lines, seller.line);
    if (pin) result.sellerPincode = { value: pin, confidence: "low" };
  }
  if (buyer) {
    result.buyerGstin = { value: buyer.value, confidence: buyer.checksum ? "high" : "low" };
    const name = nameNear(lines, buyer.line);
    if (name) result.buyerName = { value: name, confidence: "medium" };
    const state = STATES.find((item) => item.code === buyer.value.slice(0, 2))?.name ?? stateNear(lines, buyer.line);
    if (state) result.buyerState = { value: state, confidence: "high" };
    const pin = pinNear(lines, buyer.line);
    if (pin) result.buyerPincode = { value: pin, confidence: "low" };
  } else {
    const billTo = lines.findIndex((line) => /bill(ed)? to|buyer|consignee|ship to/i.test(line));
    if (billTo >= 0) {
      const candidate = lines[billTo + 1];
      if (candidate && candidate.length < 70) result.buyerName = { value: candidate.replace(/^(m\/s\.?|name:?)\s*/i, ""), confidence: "low" };
      const state = stateNear(lines, billTo);
      if (state) result.buyerState = { value: stateFromName(state)!.name, confidence: "medium" };
    }
  }

  const invoiceNo = /(?:invoice|inv|bill)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Za-z0-9/-]{1,20})/i.exec(normalized);
  if (invoiceNo && /\d/.test(invoiceNo[1]!)) result.invoiceNumber = { value: invoiceNo[1]!.toUpperCase(), confidence: "high" };

  const datePatterns = [
    /(?:invoice\s*date|inv\.?\s*date|bill\s*date|dated?)\s*[:\-]?\s*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{1,2}[\s-]*[A-Za-z]{3,9}[\s,-]*[0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i,
    /\b([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{4})\b/,
  ];
  for (const [index, pattern] of datePatterns.entries()) {
    const match = pattern.exec(normalized);
    const iso = match ? toIsoDate(match[1]!) : null;
    if (iso) {
      result.invoiceDate = { value: iso, confidence: index === 0 ? "high" : "low" };
      break;
    }
  }

  const vehicle = /\b([A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{4})\b/.exec(normalized.toUpperCase());
  if (vehicle && /vehicle|truck|lorry|veh/i.test(normalized)) {
    result.vehicleNumber = { value: vehicle[1]!.replace(/[\s-]/g, ""), confidence: "medium" };
  }

  const total = amountAfter(normalized, ["grand total", "invoice total", "total amount", "amount payable", "net amount", "total"]);
  if (total) result.totalPaise = { value: total, confidence: "medium" };
  const taxable = amountAfter(normalized, ["taxable value", "taxable amount", "sub ?total", "assessable value"]);
  if (taxable) result.taxablePaise = { value: taxable, confidence: "medium" };

  // Line items: rows that carry an HSN code followed by amounts.
  for (const line of lines) {
    const match = /^(.{3,60}?)\s+(\d{4}|\d{6}|\d{8})\s+([0-9.]+)\s*([A-Za-z]{0,5})\s+(.*)$/.exec(line);
    if (!match) continue;
    // Row layout is usually "... rate  taxable  GST%": the taxable value is the last amount before the %.
    const rest = match[5]!;
    const percent = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(rest);
    const amounts = [...(percent ? rest.slice(0, percent.index) : rest).matchAll(/[0-9][0-9,]*\.\d{2}/g)].map((item) => item[0]);
    const taxablePaise = amounts.length ? toPaise(amounts[amounts.length - 1]!) : null;
    if (!taxablePaise) continue;
    const rate = Number(percent?.[1] ?? 18);
    result.lines.push({
      description: match[1]!.replace(/^\d+[.)]?\s*/, "").trim(),
      hsn: match[2]!,
      quantity: match[3]!,
      taxablePaise,
      taxRate: [0, 3, 5, 12, 18, 28].includes(rate) ? rate : 18,
      confidence: "low",
    });
    if (result.lines.length >= 25) break;
  }
  if (!result.lines.length && (taxable ?? total)) {
    const hsn = /hsn(?:\/sac)?\s*(?:code)?\s*[:\-]?\s*(\d{4,8})/i.exec(normalized)?.[1] ?? "";
    const rate = Number(/(?:igst|gst)\s*@?\s*(\d{1,2})\s*%/i.exec(normalized)?.[1] ?? /cgst\s*@?\s*(\d{1,2}(?:\.\d)?)\s*%/i.exec(normalized)?.[1] ?? 0);
    const cgstStyle = /cgst/i.test(normalized) && !/igst\s*@?\s*\d/i.test(normalized);
    const fullRate = cgstStyle ? rate * 2 : rate;
    result.lines.push({
      description: "Goods as per invoice",
      hsn,
      quantity: "1",
      taxablePaise: taxable ?? Math.round(total! / (1 + (fullRate || 18) / 100)),
      taxRate: [0, 3, 5, 12, 18, 28].includes(fullRate) ? fullRate : 18,
      confidence: "low",
    });
  }
  return result;
}
