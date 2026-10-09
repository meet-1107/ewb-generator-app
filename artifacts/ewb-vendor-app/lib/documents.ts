import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  amountInWords,
  formatDate,
  formatInr,
  invoiceTotals,
  lineTax,
  templates,
  type EwbRecord,
  type Invoice,
} from '@/lib/domain';

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

export function invoiceHtml(invoice: Invoice) {
  const template = templates.find((item) => item.id === invoice.templateId) ?? templates[0];
  const minimal = template.id === 'minimal';
  const compact = template.id === 'compact';
  const service = template.id === 'service';
  const accent = minimal ? '#3c4a43' : template.accent;
  const totals = invoiceTotals(invoice);
  const lines = invoice.lines.filter((line) => line.description.trim() || line.taxablePaise);
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

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(invoice.invoiceNumber || 'Invoice')}</title><style>${baseCss(accent, compact)}</style></head><body>
  <div class="head"><div><h1 class="${minimal ? '' : 'accent'}">${esc(invoice.sellerName)}</h1>
    <div class="muted">${esc(invoice.sellerAddress)}</div><div class="muted">${esc(invoice.sellerState)} ${esc(invoice.sellerPincode)} · GSTIN ${esc(invoice.sellerGstin)}</div></div>
    <div style="text-align:right"><span class="badge">${esc(invoice.documentType.toUpperCase())}</span>
    <div style="margin-top:8px;font-size:14px"><strong>${esc(invoice.invoiceNumber || 'Draft')}</strong></div>
    <div class="muted">${formatDate(invoice.invoiceDate)}</div></div></div>
  ${template.id === 'dispatch' ? transport : ''}
  <div class="row" style="margin-top:${template.id === 'dispatch' ? 12 : 0}px">
    ${party(service ? 'Client' : 'Bill to', invoice.buyerName, invoice.buyerGstin, invoice.buyerAddress, invoice.buyerState, invoice.buyerPincode)}
    ${minimal ? '' : party('Ship to', invoice.buyerName, invoice.buyerGstin, invoice.shipTo || invoice.buyerAddress, invoice.buyerState, invoice.buyerPincode)}
  </div>
  <div class="muted" style="margin-top:8px">Place of supply: <strong>${esc(invoice.placeOfSupply || invoice.buyerState)}</strong> · ${invoice.supplyType === 'intra' ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}</div>
  <table><tr><th>#</th><th>${service ? 'Service' : 'Description'}</th><th>${service ? 'SAC' : 'HSN'}</th><th class="num">${service ? 'Hrs/Qty' : 'Qty'}</th>${minimal ? '' : '<th class="num">Rate</th>'}<th class="num">Taxable</th><th class="num">GST</th><th class="num">Amount</th></tr>
  ${lines.map((line, index) => `<tr><td>${index + 1}</td><td>${esc(line.description)}</td><td>${esc(line.hsn)}</td><td class="num">${esc(line.quantity)} ${esc(line.unit)}</td>${minimal ? '' : `<td class="num">${line.unitPricePaise ? formatInr(line.unitPricePaise) : '—'}</td>`}<td class="num">${formatInr(line.taxablePaise)}</td><td class="num">${line.taxRate}%</td><td class="num">${formatInr(line.taxablePaise + lineTax(line))}</td></tr>`).join('')}
  </table>
  ${template.id === 'tax-summary' ? hsnSummary : ''}
  <div class="row" style="margin-top:12px"><div class="col"><div class="label">Amount in words</div><div>${esc(amountInWords(totals.total))}</div>
    ${invoice.notes ? `<div class="label" style="margin-top:10px">Notes</div><div class="muted">${esc(invoice.notes)}</div>` : ''}</div>
    <div class="col"><table class="totals">
      <tr><td class="muted">Taxable value</td><td class="num">${formatInr(totals.taxable)}</td></tr>
      ${invoice.supplyType === 'intra' ? `<tr><td class="muted">CGST</td><td class="num">${formatInr(totals.cgst)}</td></tr><tr><td class="muted">SGST</td><td class="num">${formatInr(totals.sgst)}</td></tr>` : `<tr><td class="muted">IGST</td><td class="num">${formatInr(totals.igst)}</td></tr>`}
      <tr class="grand"><td>Total</td><td class="num">${formatInr(totals.total)}</td></tr></table></div></div>
  ${template.id !== 'dispatch' && !minimal && (invoice.vehicleNumber || invoice.ewbNumber) ? transport : ''}
  <div class="foot"><div class="muted" style="font-size:9px">Computer-generated document. Layout: ${esc(template.name)}.</div>
    <div style="text-align:center"><div style="height:40px"></div><div style="border-top:1px solid #999;padding-top:4px;font-size:10px">For ${esc(invoice.sellerName)}<br/>Authorised signatory</div></div></div>
  </body></html>`;
}

export function ewbHtml(ewb: EwbRecord, sandbox: boolean) {
  const accent = '#175b42';
  return `<!doctype html><html><head><meta charset="utf-8"><title>E-way bill ${esc(ewb.ewbNumber)}</title><style>${baseCss(accent, false)}</style></head><body>
  ${sandbox ? '<div class="watermark">SANDBOX — NOT A VALID E-WAY BILL</div>' : ''}
  <div class="head"><div><span class="badge">E-WAY BILL</span><h1 style="margin-top:8px;letter-spacing:2px">${esc(ewb.ewbNumber.replace(/(\d{4})(?=\d)/g, '$1 '))}</h1>
    <div class="muted">Generated ${formatDate(ewb.generatedAt, true)} · Valid until ${formatDate(ewb.validUntil, true)}</div></div>
    <div style="text-align:right"><div class="label">Status</div><strong>${esc(ewb.status.replace('_', ' ').toUpperCase())}</strong>
    <div class="muted" style="margin-top:4px">Source: ${esc(ewb.verificationSource)}</div></div></div>
  <div class="row">
    <div class="col box"><div class="label">From</div><strong>${esc(ewb.sellerName)}</strong><div>GSTIN ${esc(ewb.sellerGstin)}</div><div class="muted">${esc(ewb.fromState)}</div></div>
    <div class="col box"><div class="label">To</div><strong>${esc(ewb.buyerName)}</strong><div>GSTIN ${esc(ewb.buyerGstin)}</div><div class="muted">${esc(ewb.toState)}</div></div>
  </div>
  <div class="box" style="margin-top:12px"><div class="row">
    <div class="col"><div class="label">Document</div>Tax invoice ${esc(ewb.invoiceNumber)}<br/><span class="muted">${formatDate(ewb.invoiceDate)}</span></div>
    <div class="col"><div class="label">Value</div>${formatInr(ewb.totals.total)}<br/><span class="muted">Tax ${formatInr(ewb.totals.tax)}</span></div>
    <div class="col"><div class="label">Transport</div>${esc(ewb.transport.mode)} · ${esc(ewb.transport.distanceKm)} km<br/><span class="muted">${esc(ewb.transport.vehicleNumber || 'Vehicle pending')}</span></div>
    <div class="col"><div class="label">Transporter</div>${esc(ewb.transport.transporterName || '—')}<br/><span class="muted">${esc(ewb.transport.transporterId || '')}</span></div>
  </div></div>
  <table><tr><th>Product</th><th>HSN</th><th class="num">Qty</th><th class="num">Taxable</th><th class="num">Rate</th></tr>
  ${ewb.lines.map((line) => `<tr><td>${esc(line.description)}</td><td>${esc(line.hsn)}</td><td class="num">${esc(line.quantity)} ${esc(line.unit)}</td><td class="num">${formatInr(line.taxablePaise)}</td><td class="num">${line.taxRate}%</td></tr>`).join('')}</table>
  <div class="label" style="margin-top:18px">History</div>
  ${ewb.history.map((item) => `<div class="muted">${formatDate(item.at, true)} — <strong style="color:#17231c">${esc(item.action)}</strong> ${esc(item.detail)}</div>`).join('')}
  <div class="muted" style="margin-top:18px;font-size:9px">Provider bill ID ${esc(ewb.providerBillId)} · Last verified ${formatDate(ewb.lastVerifiedAt, true)}</div>
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
