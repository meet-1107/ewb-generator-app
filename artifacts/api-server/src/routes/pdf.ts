import { Router, type IRouter } from "express";
import { getDocumentProxy } from "unpdf";
import { extractInvoiceFields, type PdfRow } from "../lib/pdf-extract";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const MAX_BYTES = 8 * 1024 * 1024;

/** Rebuilds visual lines from positioned text items so label/value pairs stay together. */
async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const pages: string[] = [];
  const allRows: PdfRow[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 10); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; width: number; text: string }[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      const row = rows.get(y) ?? [];
      row.push({ x: item.transform[4], width: item.width, text: item.str.trim() });
      rows.set(y, row);
    }
    const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row.sort((a, b) => a.x - b.x));
    allRows.push(...ordered.map((cells) => ({ page: pageNumber, cells })));
    pages.push(ordered.map((row) => row.map((cell) => cell.text).join(" ")).join("\n"));
  }
  return { text: pages.join("\n"), rows: allRows, pageCount: pdf.numPages };
}

router.post("/pdf/parse", async (req, res) => {
  const base64 = typeof req.body?.contentBase64 === "string" ? req.body.contentBase64 : "";
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) return res.status(400).json({ error: "bad_request", message: "Choose a PDF to import." });
  if (bytes.length > MAX_BYTES) return res.status(413).json({ error: "too_large", message: "PDF is larger than 8 MB. Export a smaller copy and try again." });
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(415).json({ error: "not_pdf", message: "This file is not a PDF." });
  try {
    // Processed in memory only; the file is never written to disk or retained.
    const { text, rows, pageCount } = await pdfText(new Uint8Array(bytes));
    if (text.replace(/\s/g, "").length < 30) {
      return res.status(422).json({ error: "no_text", message: "This PDF looks scanned (no selectable text). Enter the details manually." });
    }
    // The app sends the user's own GSTINs so they are never taken as the buyer's.
    const ownGstins = Array.isArray(req.body?.ownGstins) ? (req.body.ownGstins as unknown[]).filter((item): item is string => typeof item === "string").slice(0, 50) : [];
    const fields = extractInvoiceFields(text, pageCount, rows, ownGstins);
    return res.json({ fields, parserVersion: "heuristic-1", retention: "Not stored. Processed in memory and discarded." });
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "PDF parse failed");
    return res.status(422).json({ error: "unreadable", message: "We could not read this PDF. It may be protected or damaged. Enter the details manually." });
  }
});

export default router;
