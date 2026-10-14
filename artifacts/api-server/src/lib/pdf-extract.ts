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
  transporterName?: Candidate;
  transporterId?: Candidate;
  totalPaise?: Candidate<number>;
  taxablePaise?: Candidate<number>;
  lines: ExtractedLine[];
  pageCount: number;
  characters: number;
};

export type ExtractedLine = { description: string; hsn: string; quantity: string; unit?: string; unitPricePaise?: number; taxablePaise: number; taxRate: number; confidence: Confidence };
/** One visual row of a PDF page: text pieces with their x position and width. */
export type PdfRow = { page: number; cells: { x: number; width: number; text: string }[] };

const MAX_LINES = 200;
const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];

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

type Column = "sl" | "desc" | "hsn" | "qty" | "unit" | "rate" | "disc" | "taxable" | "gst" | "amount";

function columnKind(raw: string): Column | null {
  const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/hsn|sac/.test(text)) return "hsn";
  if (/^(sl|s\.? ?no|sr|#|no)\b/.test(text) && text.length < 10) return "sl";
  if (/desc|particular|item|product|goods|service|name of/.test(text)) return "desc";
  if (/qty|quantity/.test(text)) return "qty";
  if (/^(uom|unit|per)\.?$/.test(text)) return "unit";
  if (/disc/.test(text)) return "disc";
  if (/taxable|assessable/.test(text)) return "taxable";
  if (/gst|tax ?(rate|%)|rate ?%|^%$/.test(text)) return "gst";
  if (/rate|price/.test(text)) return "rate";
  if (/amount|value|total|amt/.test(text)) return "amount";
  return null;
}

const UNIT_NAMES: [RegExp, string][] = [
  [/^(kg|kgs|kilo)/i, "Kgs"],
  [/^(pcs|pc|piece)/i, "Pcs"],
  [/^(nos|no|numbers?|unt|units?)$/i, "Nos"],
  [/^(mtr|mtrs|m|meter|metre)s?$/i, "Mtr"],
  [/^(ltr|ltrs|l|litre|liter)s?$/i, "Ltr"],
  [/^(box|bxs|boxes)$/i, "Box"],
  [/^(set|sets)$/i, "Set"],
  [/^(ton|tons|mt|tonne)s?$/i, "Ton"],
  [/^(hrs|hr|hours?)$/i, "Hrs"],
];

function unitName(raw: string) {
  const text = raw.replace(/[^a-z]/gi, "");
  return UNIT_NAMES.find(([pattern]) => pattern.test(text))?.[1];
}

/** "10.000 Kg" → { quantity: "10", unit: "Kgs" }. */
function quantityOf(raw: string) {
  const match = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z.]*)/.exec(raw);
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { quantity: String(value), unit: match[2] ? unitName(match[2]) : undefined };
}

function rateOf(raw: string) {
  const match = /([0-9]{1,2}(?:\.[0-9]+)?)\s*%?/.exec(raw);
  const rate = match ? Number(match[1]) : NaN;
  return GST_RATES.includes(rate) ? rate : null;
}

/** GST rate stated once for the whole invoice ("IGST @ 18%", or CGST 9% → 18). */
function documentRate(text: string) {
  const igst = /(?:igst|gst)\s*@?\s*(\d{1,2}(?:\.\d+)?)\s*%/i.exec(text)?.[1];
  if (igst && /igst/i.test(text)) return Number(igst);
  const cgst = /cgst\s*@?\s*(\d{1,2}(?:\.\d+)?)\s*%/i.exec(text)?.[1];
  if (cgst) return Number(cgst) * 2;
  return igst ? Number(igst) : 0;
}

const center = (cell: { x: number; width: number }) => cell.x + cell.width / 2;
const STOP_ROW = /\b(sub ?total|grand total|total|amount chargeable|amount in words)\b/i;
const TAX_ROW = /\b(cgst|sgst|utgst|igst|output|round(ed)? off|less|freight|packing)\b/i;

/**
 * Line items from the invoice's item table: finds the header row (HSN, Qty,
 * Amount…), maps each later row's text to the nearest header column, and reads
 * one product per row until the totals. Description text on its own row is a
 * wrapped description and joins the product above.
 */
export function tableLines(rows: PdfRow[], fallbackRate: number): ExtractedLine[] {
  const lines: ExtractedLine[] = [];
  let header: { kind: Column; center: number }[] | null = null;
  let last: ExtractedLine | null = null;
  let page = 0;
  for (const row of rows) {
    // A table can run onto the next page without repeating its header.
    if (row.page !== page) {
      page = row.page;
      last = null;
    }
    const kinds = row.cells.map((cell) => ({ kind: columnKind(cell.text), center: center(cell) }));
    const found = new Set(kinds.map((item) => item.kind));
    if ((found.has("hsn") || found.has("desc")) && found.has("qty") && (found.has("amount") || found.has("taxable") || found.has("rate"))) {
      header = kinds.filter((item): item is { kind: Column; center: number } => item.kind !== null);
      last = null;
      continue;
    }
    if (!header) continue;

    const values = new Map<Column, string[]>();
    for (const cell of row.cells) {
      const position = center(cell);
      const nearest = header.reduce((best, column) => (Math.abs(column.center - position) < Math.abs(best.center - position) ? column : best));
      values.set(nearest.kind, [...(values.get(nearest.kind) ?? []), cell.text]);
    }
    const get = (kind: Column) => (values.get(kind) ?? []).join(" ").trim();
    const getAll = (kind: Column) => values.get(kind) ?? [];
    const hsn = /^\d{4,8}$/.test(get("hsn").replace(/\s/g, "")) ? get("hsn").replace(/\s/g, "") : "";
    const description = get("desc").replace(/^\d+[.)]?\s+/, "").trim();
    const rowText = row.cells.map((cell) => cell.text).join(" ");

    if (!hsn && STOP_ROW.test(rowText)) {
      header = null;
      last = null;
      continue;
    }
    if (!hsn && TAX_ROW.test(description)) continue;

    const quantity = quantityOf(get("qty"));
    const rate = toPaise(get("rate").split(/\s+/)[0] ?? "");
    const amountText = get("taxable") || getAll("amount")[0] || "";
    let taxablePaise = toPaise(amountText.split(/\s+/)[0] ?? "");
    if (!taxablePaise && quantity && rate) taxablePaise = Math.round(Number(quantity.quantity) * rate);

    if ((hsn || quantity) && taxablePaise && (description || hsn)) {
      const gst = rateOf(get("gst"));
      last = {
        description: description || `Item ${lines.length + 1}`,
        hsn,
        quantity: quantity?.quantity ?? "1",
        ...(quantity?.unit || unitName(get("unit")) ? { unit: quantity?.unit ?? unitName(get("unit")) } : {}),
        ...(rate ? { unitPricePaise: rate } : {}),
        taxablePaise,
        taxRate: gst ?? (GST_RATES.includes(fallbackRate) && fallbackRate ? fallbackRate : 18),
        confidence: hsn && quantity ? "medium" : "low",
      };
      lines.push(last);
      if (lines.length >= MAX_LINES) break;
    } else if (last && description && !/\d{3,}/.test(rowText.replace(description, "")) && last.description.length < 160) {
      // A wrapped description (or batch/size detail) under the product.
      last.description = `${last.description} ${description}`;
    }
  }
  return lines;
}

const TRANSPORTER_LABEL = /^(transporter(?:'s)?(?: name)?|transport(?:er)? co\.?|transport|dispatched through|despatched through|carrier(?: name)?|courier(?: name)?|name of transporter)\s*[:\-]?\s*/i;
// Neighbouring labels that are not a transporter's name.
const NOT_A_NAME = /^(destination|vehicle|motor|lr|gr|l\.r|g\.r|date|dated|bill of lading|terms|delivery|mode|transporter id|trans(?:porter)? id|gstin|e-?way|ewb|place|dispatch doc)/i;

function cleanName(raw: string) {
  const value = raw.replace(/^[:\-\s]+/, "").split(/\s{2,}|\s+(?:vehicle|lr|gr|destination|date|gstin|transporter id)\b/i)[0]!.trim();
  return value.length >= 3 && value.length <= 60 && /[a-z]/i.test(value) && !NOT_A_NAME.test(value) && !/^[\d\s/.-]+$/.test(value) ? value : null;
}

/**
 * Transporter's name from a label such as "Transporter:", "Dispatched through"
 * or "Carrier": the text after it, the next cell on that row, or the cell
 * right under it (Tally prints labels and values in stacked boxes).
 */
function transporterName(rows: PdfRow[], lines: string[]) {
  for (const [index, row] of rows.entries()) {
    for (const [cellIndex, cell] of row.cells.entries()) {
      const label = TRANSPORTER_LABEL.exec(cell.text);
      if (!label || /transporter id|trans id/i.test(cell.text)) continue;
      const inline = cleanName(cell.text.slice(label[0].length));
      if (inline) return inline;
      const right = row.cells[cellIndex + 1];
      if (right && right.x - (cell.x + cell.width) < 80) {
        const value = cleanName(right.text);
        if (value) return value;
      }
      const below = rows[index + 1];
      if (below && below.page === row.page) {
        const under = below.cells.reduce<PdfRow["cells"][number] | null>((best, item) => (!best || Math.abs(item.x - cell.x) < Math.abs(best.x - cell.x) ? item : best), null);
        const value = under && Math.abs(under.x - cell.x) < 40 ? cleanName(under.text) : null;
        if (value) return value;
      }
    }
  }
  for (const line of lines) {
    const match = /(?:transporter(?:'s)?(?: name)?|dispatched through|despatched through|carrier(?: name)?|name of transporter)\s*[:\-]\s*(.+)$/i.exec(line);
    const value = match ? cleanName(match[1]!) : null;
    if (value) return value;
  }
  return null;
}

const TRANSPORTER_ID_LABEL = /(transporter|transport|trans)\.?\s*(id|gstin|gst no|gst)|transin/i;

/** Transporter ID (a GSTIN or 15-character TRANSIN) on a labelled line or the line under it. */
function transporterId(lines: string[]) {
  for (const [index, line] of lines.entries()) {
    const label = TRANSPORTER_ID_LABEL.exec(line);
    if (!label) continue;
    for (const text of [line.slice(label.index), lines[index + 1] ?? ""]) {
      const id = /\b(\d{2}[A-Z0-9]{13})\b/.exec(text.toUpperCase())?.[1];
      if (id) return id;
    }
  }
  return null;
}

export function extractInvoiceFields(text: string, pageCount: number, rows: PdfRow[] = []): ExtractedInvoice {
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const result: ExtractedInvoice = { lines: [], pageCount, characters: normalized.length };

  // The transporter's GSTIN/TRANSIN is neither the seller nor the buyer.
  const transporterIdValue = transporterId(lines);
  if (transporterIdValue) result.transporterId = { value: transporterIdValue, confidence: "medium" };

  // GSTINs in reading order: first is usually the seller, the next distinct one the buyer.
  const gstins: { value: string; line: number; checksum: boolean }[] = [];
  lines.forEach((line, index) => {
    for (const match of line.toUpperCase().matchAll(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/g)) {
      if (match[1] === transporterIdValue) continue;
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
  const transporter = transporterName(rows, lines);
  if (transporter) result.transporterName = { value: transporter, confidence: "medium" };

  const total = amountAfter(normalized, ["grand total", "invoice total", "total amount", "amount payable", "net amount", "total"]);
  if (total) result.totalPaise = { value: total, confidence: "medium" };
  const taxable = amountAfter(normalized, ["taxable value", "taxable amount", "sub ?total", "assessable value"]);
  if (taxable) result.taxablePaise = { value: taxable, confidence: "medium" };

  // Line items: from the item table's columns when the PDF has one; otherwise
  // rows that carry an HSN code followed by amounts.
  result.lines = tableLines(rows, documentRate(normalized));
  for (const line of result.lines.length ? [] : lines) {
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
    if (result.lines.length >= MAX_LINES) break;
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
