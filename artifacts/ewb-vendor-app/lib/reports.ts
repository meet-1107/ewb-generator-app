import { formatDate, formatInr, invoiceTotals, isPurchase, type Business, type EwbRecord, type Invoice } from '@/lib/domain';

/** What a report covers: the dates (YYYY-MM-DD, inclusive), one party or all, and which sections. */
export type ReportFilter = { from: string; to: string; party: string; kind: 'sales' | 'purchase' | 'ewb' | 'both' };

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const samePARTY = (name: string, party: string) => !party || name.trim().toLowerCase() === party.trim().toLowerCase();
/** The other side of an invoice: the buyer on a sale, the seller (party) on a purchase. */
export const partyOf = (invoice: Invoice) => (isPurchase(invoice) ? { name: invoice.sellerName, gstin: invoice.sellerGstin } : { name: invoice.buyerName, gstin: invoice.buyerGstin });

/** Saved invoices (not drafts) dated in the period, oldest first. */
export function reportInvoices(invoices: Invoice[], filter: ReportFilter) {
  return invoices
    .filter((invoice) => !invoice.unsaved && invoice.status !== 'draft' && invoice.invoiceDate >= filter.from && invoice.invoiceDate <= filter.to && samePARTY(partyOf(invoice).name, filter.party))
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true }));
}

/** E-way bills generated in the period (India time), oldest first. */
export function reportEwbs(ewbs: EwbRecord[], filter: ReportFilter) {
  const day = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
  return ewbs
    .filter((ewb) => day(ewb.generatedAt) >= filter.from && day(ewb.generatedAt) <= filter.to && samePARTY(ewb.buyerName, filter.party))
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
}

export function salesSummary(invoices: Invoice[]) {
  const sum = { count: invoices.length, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  for (const invoice of invoices) {
    const totals = invoiceTotals(invoice);
    sum.taxable += totals.taxable;
    sum.cgst += totals.cgst;
    sum.sgst += totals.sgst;
    sum.igst += totals.igst;
    sum.total += totals.total;
  }
  return sum;
}

/** Taxable value and tax per GST rate (the breakup a CA files GSTR-1 / GSTR-3B from). */
function rateSummary(invoices: Invoice[]) {
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const invoice of invoices) {
    for (const line of invoice.lines) {
      const entry = byRate.get(line.taxRate) ?? { taxable: 0, tax: 0 };
      entry.taxable += line.taxablePaise;
      entry.tax += Math.round((line.taxablePaise * line.taxRate) / 100);
      byRate.set(line.taxRate, entry);
    }
  }
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]);
}

function partySummary(invoices: Invoice[]) {
  const byParty = new Map<string, { name: string; gstin: string; count: number; taxable: number; total: number }>();
  for (const invoice of invoices) {
    const party = partyOf(invoice);
    const key = party.name.trim().toLowerCase() || '—';
    const totals = invoiceTotals(invoice);
    const entry = byParty.get(key) ?? { name: party.name.trim() || '—', gstin: party.gstin, count: 0, taxable: 0, total: 0 };
    entry.count += 1;
    entry.taxable += totals.taxable;
    entry.total += totals.total;
    byParty.set(key, entry);
  }
  return [...byParty.values()].sort((a, b) => b.total - a.total);
}

const EWB_STATUS: Record<EwbRecord['status'], string> = { active: 'Active', expired: 'Expired', cancelled: 'Cancelled', part_b_pending: 'Part-B pending' };

/** The report as a printable A4 (landscape) page for PDF. */
export function reportHtml(business: Business | null, invoices: Invoice[], ewbs: EwbRecord[], filter: ReportFilter, periodLabel: string) {
  const green = '#175b42', gold = '#f2b230', line = '#d9ddd9', soft = '#f2f7f4';
  const sales = salesSummary(invoices);
  const rates = rateSummary(invoices);
  const parties = filter.party ? [] : partySummary(invoices);
  const showSales = filter.kind !== 'ewb';
  const showEwb = filter.kind === 'ewb' || filter.kind === 'both';
  // A purchase report lists bills from your parties, with no e-way bill column.
  const purchase = filter.kind === 'purchase';
  const title = filter.kind === 'sales' ? 'Sales report' : purchase ? 'Purchase report' : filter.kind === 'ewb' ? 'E-way bill report' : 'Sales & e-way bill report';
  const th = (text: string, num = false) => `<th class="${num ? 'num' : ''}">${text}</th>`;
  const activeEwbs = ewbs.filter((ewb) => ewb.status !== 'cancelled');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { background: #ffffff; color-scheme: light; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1b2420; font-size: 10.5px; margin: 0; }
  .head { background: ${green}; color: #fff; padding: 14px 16px; border-radius: 10px 10px 0 0; display: flex; justify-content: space-between; align-items: flex-end; }
  .bar { height: 4px; background: ${gold}; margin-bottom: 12px; }
  h1 { font-size: 18px; margin: 0; } h2 { font-size: 13px; color: ${green}; margin: 16px 0 6px; }
  .muted { color: #5d6a63; } .head .muted { color: #d6e7de; }
  .cards { display: flex; gap: 8px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 120px; background: ${soft}; border: 1px solid ${line}; border-radius: 8px; padding: 8px 10px; }
  .card b { display: block; font-size: 14px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: ${green}; color: #fff; text-align: left; padding: 5px 6px; font-size: 9.5px; }
  td { padding: 4px 6px; border-bottom: 1px solid ${line}; vertical-align: top; background: #ffffff; color: #1b2420; }
  tr:nth-child(even) td { background: #fafbfa; }
  .num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; background: ${soft} !important; border-top: 2px solid ${green}; }
  .foot { margin-top: 14px; font-size: 9px; color: #5d6a63; display: flex; justify-content: space-between; }
  </style></head><body>
  <div class="head">
    <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em">E-WAY <span style="color:${gold}">EASY</span></div><h1>${esc(title)}</h1>
      <div class="muted">${esc(periodLabel)}${filter.party ? ` · Party: ${esc(filter.party)}` : ' · All parties'}</div></div>
    <div style="text-align:right"><div style="font-size:13px;font-weight:700">${esc(business?.name ?? '')}</div>
      <div class="muted">GSTIN ${esc(business?.gstin ?? '—')}${business?.state ? ` · ${esc(business.state)}` : ''}</div></div>
  </div>
  <div class="bar"></div>

  <div class="cards">
    ${showSales ? `<div class="card">${purchase ? 'Purchase bills' : 'Invoices'}<b>${sales.count}</b></div>
    <div class="card">Taxable value<b>${formatInr(sales.taxable)}</b></div>
    <div class="card">CGST + SGST<b>${formatInr(sales.cgst + sales.sgst)}</b></div>
    <div class="card">IGST<b>${formatInr(sales.igst)}</b></div>
    <div class="card">${purchase ? 'Total purchases' : 'Total sales'}<b>${formatInr(sales.total)}</b></div>` : ''}
    ${showEwb ? `<div class="card">E-way bills<b>${ewbs.length}</b><span class="muted">${ewbs.length - activeEwbs.length} cancelled</span></div>` : ''}
  </div>

  ${showSales ? `<h2>${purchase ? 'Purchase bills' : 'Sales invoices'}</h2>
  ${invoices.length ? `<table><thead><tr>${th('#')}${th('Date')}${th(purchase ? 'Bill no.' : 'Invoice no.')}${th('Party')}${th('Party GSTIN')}${th('Place of supply')}${th('Taxable', true)}${th('CGST', true)}${th('SGST', true)}${th('IGST', true)}${th('Total', true)}${purchase ? '' : th('E-way bill')}</tr></thead><tbody>
  ${invoices.map((invoice, index) => {
    const totals = invoiceTotals(invoice);
    const party = partyOf(invoice);
    return `<tr><td>${index + 1}</td><td>${formatDate(invoice.invoiceDate)}</td><td>${esc(invoice.invoiceNumber)}</td><td>${esc(party.name)}</td><td>${esc(party.gstin || 'Unregistered')}</td><td>${esc(invoice.placeOfSupply || invoice.buyerState)}</td><td class="num">${formatInr(totals.taxable)}</td><td class="num">${formatInr(totals.cgst)}</td><td class="num">${formatInr(totals.sgst)}</td><td class="num">${formatInr(totals.igst)}</td><td class="num">${formatInr(totals.total)}</td>${purchase ? '' : `<td>${esc(invoice.ewbNumber ?? '—')}</td>`}</tr>`;
  }).join('')}</tbody>
  <tfoot><tr><td colspan="6">Total (${sales.count} ${purchase ? 'bills' : 'invoices'})</td><td class="num">${formatInr(sales.taxable)}</td><td class="num">${formatInr(sales.cgst)}</td><td class="num">${formatInr(sales.sgst)}</td><td class="num">${formatInr(sales.igst)}</td><td class="num">${formatInr(sales.total)}</td>${purchase ? '' : '<td></td>'}</tr></tfoot></table>` : `<p class="muted">No ${purchase ? 'purchases' : 'invoices'} in this period.</p>`}

  ${rates.length ? `<h2>GST rate-wise summary</h2><table style="width:55%"><thead><tr>${th('GST rate')}${th('Taxable value', true)}${th('Tax', true)}${th('Total', true)}</tr></thead><tbody>
  ${rates.map(([rate, entry]) => `<tr><td>${rate}%</td><td class="num">${formatInr(entry.taxable)}</td><td class="num">${formatInr(entry.tax)}</td><td class="num">${formatInr(entry.taxable + entry.tax)}</td></tr>`).join('')}</tbody></table>` : ''}

  ${parties.length > 1 ? `<h2>Party-wise summary</h2><table style="width:75%"><thead><tr>${th('Party')}${th('GSTIN')}${th(purchase ? 'Bills' : 'Invoices', true)}${th('Taxable', true)}${th('Total', true)}</tr></thead><tbody>
  ${parties.map((party) => `<tr><td>${esc(party.name)}</td><td>${esc(party.gstin || 'Unregistered')}</td><td class="num">${party.count}</td><td class="num">${formatInr(party.taxable)}</td><td class="num">${formatInr(party.total)}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}

  ${showEwb ? `<h2>E-way bills</h2>
  ${ewbs.length ? `<table><thead><tr>${th('#')}${th('Generated')}${th('EWB no.')}${th('Invoice no.')}${th('Party')}${th('From → To')}${th('Vehicle')}${th('Value', true)}${th('Valid until')}${th('Status')}</tr></thead><tbody>
  ${ewbs.map((ewb, index) => `<tr><td>${index + 1}</td><td>${formatDate(ewb.generatedAt, true)}</td><td><b>${esc(ewb.ewbNumber)}</b></td><td>${esc(ewb.invoiceNumber)}</td><td>${esc(ewb.buyerName)}</td><td>${esc(ewb.fromState)} → ${esc(ewb.toState)}</td><td>${esc(ewb.transport.vehicleNumber || '—')}</td><td class="num">${formatInr(ewb.totals.total)}</td><td>${ewb.status === 'cancelled' ? '—' : formatDate(ewb.validUntil, true)}</td><td>${EWB_STATUS[ewb.status]}</td></tr>`).join('')}</tbody>
  <tfoot><tr><td colspan="7">Total (${activeEwbs.length} not cancelled)</td><td class="num">${formatInr(activeEwbs.reduce((sum, ewb) => sum + ewb.totals.total, 0))}</td><td colspan="2"></td></tr></tfoot></table>` : '<p class="muted">No e-way bills in this period.</p>'}` : ''}

  <div class="foot"><span>Generated by E-Way Easy on ${formatDate(new Date().toISOString(), true)}. Drafts are not included.</span><span>For ${esc(business?.name ?? '')}</span></div>
  </body></html>`;
}
