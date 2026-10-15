import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as LegacyFS from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  amountInWords,
  formatDate,
  formatInr,
  hasDispatch,
  hasShipTo,
  invoiceTotals,
  lineTax,
  signatureHtml,
  type Signature,
  templates,
  type EwbRecord,
  type Invoice,
} from '@/lib/domain';
import { code128Svg } from '@/lib/code128';
import { ewbSheet, qrPath } from '@/lib/ewb-sheet';

const esc = (value: string | number | undefined) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const baseCss = (accent: string, compact: boolean) => `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #17231c; margin: 0; padding: 28px; font-size: ${compact ? 10 : 12}px; }
  h1 { font-size: ${compact ? 18 : 22}px; margin: 0; letter-spacing: -0.3px; }
  .muted { color: #5f6a63; }
  .accent { color: ${accent}; }
  .row { display: flex; gap: 16px; }
  .col { flex: 1; }
  .box { border: 1px solid #dfe2d9; border-radius: 10px; padding: 12px; }
  .label { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #5f6a63; margin-bottom: 4px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th { background: ${accent}; color: #fff; text-align: left; padding: ${compact ? '5px 6px' : '8px'}; font-size: ${compact ? 9 : 10}px; text-transform: uppercase; letter-spacing: .5px; }
  td { padding: ${compact ? '5px 6px' : '8px'}; border-bottom: 1px solid #ecede6; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .totals td { border: none; padding: 4px 8px; }
  .grand td { font-size: ${compact ? 13 : 15}px; font-weight: 700; border-top: 2px solid ${accent}; padding-top: 8px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${accent}; padding-bottom: 14px; margin-bottom: 16px; }
  .badge { display: inline-block; padding: 3px 8px; border-radius: 99px; background: ${accent}1a; color: ${accent}; font-weight: 700; font-size: 10px; letter-spacing: .6px; }
  .foot { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
  .watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 46px; font-weight: 800; color: rgba(184,63,50,.12); transform: rotate(-24deg); pointer-events: none; }
`;

/** `signature`: the business's saved signature, printed above "Authorised signatory". */
export function invoiceHtml(invoice: Invoice, signature?: Signature) {
  const template = templates.find((item) => item.id === invoice.templateId) ?? templates[0];
  const minimal = template.id === 'minimal';
  const compact = template.id === 'compact';
  const service = template.id === 'service';
  const accent = minimal ? '#3c4a43' : template.accent;
  const totals = invoiceTotals(invoice);
  const lines = invoice.lines.filter((line) => line.description.trim() || line.taxablePaise);
  const discounted = lines.some((line) => line.discountPaise);
  const party = (title: string, name: string, gstin: string, address: string, state: string, pin: string) => `
    <div class="col box"><div class="label">${title}</div><strong>${esc(name) || '—'}</strong>
    <div class="muted">${esc(address)}</div><div class="muted">${esc(state)} ${esc(pin)}</div>
    <div style="margin-top:4px">GSTIN: <strong>${esc(gstin || 'Unregistered')}</strong></div></div>`;
  const transport = `
    <div class="box" style="margin-top:12px"><div class="label">Transport</div>
    <div class="row"><div class="col">Mode: <strong>${esc(invoice.transportMode)}</strong></div>
    <div class="col">Vehicle: <strong>${esc(invoice.vehicleNumber || '—')}</strong></div>
    <div class="col">Distance: <strong>${esc(invoice.distanceKm || '—')} km</strong></div>
    <div class="col">Transporter: <strong>${esc(invoice.transporterName || '—')}</strong></div></div>
    ${invoice.ewbNumber ? `<div style="margin-top:6px">E-way bill: <strong>${esc(invoice.ewbNumber)}</strong></div>` : ''}</div>`;
  const hsnSummary = (() => {
    const groups = new Map<string, { taxable: number; tax: number; rate: number }>();
    for (const line of lines) {
      const key = `${line.hsn || '—'}@${line.taxRate}`;
      const group = groups.get(key) ?? { taxable: 0, tax: 0, rate: line.taxRate };
      group.taxable += line.taxablePaise;
      group.tax += lineTax(line);
      groups.set(key, group);
    }
    return `<table><tr><th>HSN/SAC</th><th class="num">Taxable</th><th class="num">Rate</th>${invoice.supplyType === 'intra' ? '<th class="num">CGST</th><th class="num">SGST</th>' : '<th class="num">IGST</th>'}<th class="num">Total tax</th></tr>
      ${[...groups.entries()].map(([key, group]) => `<tr><td>${esc(key.split('@')[0])}</td><td class="num">${formatInr(group.taxable)}</td><td class="num">${group.rate}%</td>${invoice.supplyType === 'intra' ? `<td class="num">${formatInr(Math.round(group.tax / 2))}</td><td class="num">${formatInr(group.tax - Math.round(group.tax / 2))}</td>` : `<td class="num">${formatInr(group.tax)}</td>`}<td class="num">${formatInr(group.tax)}</td></tr>`).join('')}</table>`;
  })();

  const bank = invoice.bank ? `<div class="label" style="margin-top:10px">Bank details</div>
    <div><strong>${esc(invoice.bank.accountName)}</strong></div>
    <div>${esc(invoice.bank.bankName)}${invoice.bank.branch ? `, ${esc(invoice.bank.branch)}` : ''}</div>
    <div>A/c no: <strong>${esc(invoice.bank.accountNumber)}</strong> · ${esc(invoice.bank.accountType)}</div>
    <div>IFSC: <strong>${esc(invoice.bank.ifsc)}</strong></div>
    ${invoice.bank.upiId ? `<div>UPI: <strong>${esc(invoice.bank.upiId)}</strong></div>` : ''}` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(invoice.invoiceNumber || 'Invoice')}</title><style>${baseCss(accent, compact)}</style></head><body>
  <div class="head"><div><h1 class="${minimal ? '' : 'accent'}">${esc(invoice.sellerName)}</h1>
    <div class="muted">${esc(invoice.sellerAddress)}</div><div class="muted">${esc(invoice.sellerState)} ${esc(invoice.sellerPincode)} · GSTIN ${esc(invoice.sellerGstin)}</div>
    ${hasDispatch(invoice) ? `<div class="muted">Dispatch from: ${esc(invoice.dispatchFrom || invoice.sellerAddress)}, ${esc(invoice.dispatchState)} ${esc(invoice.dispatchPincode)}</div>` : ''}</div>
    <div style="text-align:right"><span class="badge">${esc(invoice.documentType.toUpperCase())}</span>
    <div style="margin-top:8px;font-size:14px"><strong>${esc(invoice.invoiceNumber || 'Draft')}</strong></div>
    <div class="muted">${formatDate(invoice.invoiceDate)}</div></div></div>
  ${template.id === 'dispatch' ? transport : ''}
  <div class="row" style="margin-top:${template.id === 'dispatch' ? 12 : 0}px">
    ${party(service ? 'Client' : 'Bill to', invoice.buyerName, invoice.buyerGstin, invoice.buyerAddress, invoice.buyerState, invoice.buyerPincode)}
    ${minimal ? '' : hasShipTo(invoice)
      ? party('Ship to', invoice.buyerName, invoice.buyerGstin, invoice.shipTo || invoice.buyerAddress, invoice.shipToState, invoice.shipToPincode)
      : party('Ship to', invoice.buyerName, invoice.buyerGstin, invoice.buyerAddress, invoice.buyerState, invoice.buyerPincode)}
  </div>
  <div class="muted" style="margin-top:8px">Place of supply: <strong>${esc(invoice.placeOfSupply || invoice.buyerState)}</strong> · ${invoice.supplyType === 'intra' ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}</div>
  <table><tr><th>#</th><th>${service ? 'Service' : 'Description'}</th><th>${service ? 'SAC' : 'HSN'}</th><th class="num">${service ? 'Hrs/Qty' : 'Qty'}</th>${minimal ? '' : '<th class="num">Rate</th>'}${discounted ? '<th class="num">Disc.</th>' : ''}<th class="num">Taxable</th><th class="num">GST</th><th class="num">Amount</th></tr>
  ${lines.map((line, index) => `<tr><td>${index + 1}</td><td>${esc(line.description)}</td><td>${esc(line.hsn)}</td><td class="num">${esc(line.quantity)} ${esc(line.unit)}</td>${minimal ? '' : `<td class="num">${line.unitPricePaise ? formatInr(line.unitPricePaise) : '—'}</td>`}${discounted ? `<td class="num">${line.discountPaise ? formatInr(line.discountPaise) : '—'}</td>` : ''}<td class="num">${formatInr(line.taxablePaise)}</td><td class="num">${line.taxRate}%</td><td class="num">${formatInr(line.taxablePaise + lineTax(line))}</td></tr>`).join('')}
  </table>
  ${template.id === 'tax-summary' ? hsnSummary : ''}
  <div class="row" style="margin-top:12px"><div class="col"><div class="label">Amount in words</div><div>${esc(amountInWords(totals.total))}</div>
    ${bank}
    ${invoice.notes ? `<div class="label" style="margin-top:10px">Notes</div><div class="muted">${esc(invoice.notes)}</div>` : ''}</div>
    <div class="col"><table class="totals">
      <tr><td class="muted">Taxable value</td><td class="num">${formatInr(totals.taxable)}</td></tr>
      ${invoice.supplyType === 'intra' ? `<tr><td class="muted">CGST</td><td class="num">${formatInr(totals.cgst)}</td></tr><tr><td class="muted">SGST</td><td class="num">${formatInr(totals.sgst)}</td></tr>` : `<tr><td class="muted">IGST</td><td class="num">${formatInr(totals.igst)}</td></tr>`}
      <tr class="grand"><td>Total</td><td class="num">${formatInr(totals.total)}</td></tr></table></div></div>
  ${template.id !== 'dispatch' && !minimal && (invoice.vehicleNumber || invoice.ewbNumber) ? transport : ''}
  <div class="foot"><div class="muted" style="font-size:9px">Computer-generated document. Layout: ${esc(template.name)}.</div>
    <div style="text-align:center;min-width:150px"><div style="height:52px;display:flex;align-items:flex-end;justify-content:center">${signatureHtml(signature)}</div><div style="border-top:1px solid #999;padding-top:4px;font-size:10px">For ${esc(invoice.sellerName)}<br/>Authorised signatory</div></div></div>
  </body></html>`;
}

/** The e-way bill in the NIC portal's print layout (EWB-01), from the same model as the in-app preview. */
export function ewbHtml(ewb: EwbRecord, sandbox: boolean, invoice?: Invoice | null) {
  const sheet = ewbSheet(ewb, invoice);
  const qr = qrPath(sheet.qrText);
  const rows = (items: [string, string][]) => items.map(([label, value]) => `<tr><td class="l">${esc(label)}</td><td class="v">${esc(value)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>e-Way Bill ${esc(ewb.ewbNumber)}</title><style>
  * { box-sizing: border-box; }
  @page { margin: 12mm; }
  body { font-family: 'Open Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #000; margin: 0; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  .sheet { border: 1px solid #999; }
  .title { text-align: center; padding: 8px 0 10px; border-bottom: 1px solid #999; }
  .title h1 { font-size: 20px; margin: 0 0 6px; font-weight: 700; }
  .main td { border: 1px solid #999; padding: 9px 6px; vertical-align: middle; }
  .main td.l { width: 37%; }
  .main td.v { font-weight: 700; }
  .main td.big { font-size: 15px; }
  .section td { font-weight: 700; padding: 9px 6px; border: 1px solid #999; }
  .partb { margin: 6px; width: calc(100% - 12px); }
  .partb th, .partb td { border: 1px solid #999; padding: 7px 5px; text-align: left; font-size: 10.5px; }
  .partb th { font-weight: 700; }
  .barcode { text-align: center; padding: 10px 0 6px; border: 1px solid #999; border-top: 0; font-size: 9px; }
  .note { border: 1px solid #999; border-top: 0; padding: 8px 6px; font-size: 9px; }
  .stamp { position: fixed; top: 38%; left: 0; right: 0; text-align: center; font-size: 64px; font-weight: 800; color: rgba(190,30,30,.18); transform: rotate(-24deg); }
  .sandbox { position: fixed; top: 52%; left: 0; right: 0; text-align: center; font-size: 34px; font-weight: 800; color: rgba(190,30,30,.15); transform: rotate(-24deg); }
  </style></head><body>
  ${sheet.stamp ? `<div class="stamp">${sheet.stamp}</div>` : ''}
  ${sandbox ? '<div class="sandbox">TEST BILL — NOT VALID FOR TRANSPORT</div>' : ''}
  <div class="sheet">
    <div class="title"><h1>e-Way Bill</h1>
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="-2 -2 ${qr.size + 4} ${qr.size + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${qr.size + 4}" height="${qr.size + 4}" fill="#fff"/><path d="${qr.d}" fill="#000"/></svg>
    </div>
    <table class="main">
      ${sheet.header.map(([label, value], index) => `<tr><td class="l">${esc(label)}</td><td class="v${index === 0 ? ' big' : ''}">${esc(value)}</td></tr>`).join('')}
      <tr class="section"><td colspan="2">Part - A</td></tr>
      ${rows(sheet.partA)}
      <tr class="section"><td colspan="2">Part - B</td></tr>
      <tr><td colspan="2" style="padding:0;border:1px solid #999">
        <table class="partb"><tr><th>Mode</th><th>Vehicle / Trans<br/>Doc No &amp; Dt.</th><th>From</th><th>Entered Date</th><th>Entered By</th><th>CEWB No.<br/>(If any)</th><th>Multi Veh.Info<br/>(If any)</th></tr>
        ${sheet.partB.length ? sheet.partB.map((row) => `<tr><td>${esc(row.mode)}</td><td>${esc(row.vehicle)}</td><td>${esc(row.from)}</td><td>${esc(row.enteredDate)}</td><td>${esc(row.enteredBy)}</td><td>${esc(row.cewb)}</td><td>${esc(row.multiVehicle)}</td></tr>`).join('') : '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'}
        </table></td></tr>
    </table>
  </div>
  <div class="barcode">${code128Svg(ewb.ewbNumber)}<div>${esc(ewb.ewbNumber)}</div></div>
  <div class="note">Note*: If any discrepancy in information please try after sometimes. Printed from E-Way Easy; the e-way bill portal (ewaybillgst.gov.in) is the authoritative record.</div>
  </body></html>`;
}

export async function printHtml(html: string) {
  await Print.printAsync({ html });
}

/** Renders a PDF and opens the OS share sheet (web falls back to the print dialog). */
export async function shareHtmlAsPdf(html: string, fileLabel: string) {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return 'printed';
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: fileLabel });
  return 'shared';
}

/** Folder the user allowed once (Android); later downloads save there without asking. */
const DOWNLOAD_DIR_KEY = 'ewb-vendor-v1:download-dir';

export type SavedPdf = { status: 'saved'; fileName: string; uri: string } | { status: 'cancelled' | 'printed' | 'shared' };

/**
 * Saves the PDF on the phone. Android: into the folder chosen the first time (the picker
 * opens at Download), remembered after that. iOS has no shared Downloads folder, so the
 * share sheet's "Save to Files" is used; web prints.
 */
export async function downloadHtmlAsPdf(html: string, fileLabel: string): Promise<SavedPdf> {
  if (Platform.OS !== 'android') return { status: await shareHtmlAsPdf(html, fileLabel) as 'printed' | 'shared' };
  const { uri } = await Print.printToFileAsync({ html });
  const fileName = `${fileLabel.replace(/[^\w.-]+/g, '_')}.pdf`;
  const data = await LegacyFS.readAsStringAsync(uri, { encoding: LegacyFS.EncodingType.Base64 });
  const SAF = LegacyFS.StorageAccessFramework;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let dir = await AsyncStorage.getItem(DOWNLOAD_DIR_KEY).catch(() => null);
    if (!dir) {
      const permission = await SAF.requestDirectoryPermissionsAsync(SAF.getUriForDirectoryInRoot('Download'));
      if (!permission.granted) return { status: 'cancelled' };
      dir = permission.directoryUri;
      await AsyncStorage.setItem(DOWNLOAD_DIR_KEY, dir).catch(() => undefined);
    }
    try {
      const target = await SAF.createFileAsync(dir, fileName.replace(/\.pdf$/, ''), 'application/pdf');
      await LegacyFS.writeAsStringAsync(target, data, { encoding: LegacyFS.EncodingType.Base64 });
      return { status: 'saved', fileName, uri };
    } catch (error) {
      // Folder removed or access revoked: ask for a folder again (once).
      await AsyncStorage.removeItem(DOWNLOAD_DIR_KEY).catch(() => undefined);
      if (attempt === 1) throw error;
    }
  }
  return { status: 'cancelled' };
}

/** Opens the share sheet for a PDF already rendered on the phone. */
export async function sharePdfFile(uri: string, fileLabel: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: fileLabel });
}
