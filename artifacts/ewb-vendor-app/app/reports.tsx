import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, ChipRow, Divider, Field, KeyValue, ScreenHeader, SectionTitle, Segmented, SelectSheet, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { usePdfActions } from '@/hooks/usePdfActions';
import { DOCUMENT_TYPES, formatInr } from '@/lib/domain';
import { partyOf, reportEwbs, reportHtml, reportInvoices, salesSummary, type ReportFilter } from '@/lib/reports';
import { useAppStore, useScopedRecords } from '@/state/app-store';

/** India-time calendar date, YYYY-MM-DD. */
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const monthEnd = (month: string) => {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00+05:30`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dateLabel = (date: string) => new Date(`${date}T00:00:00+05:30`).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The financial year (April–March) that contains a date: [from, to]. */
function financialYear(date: string, back = 0): [string, string] {
  const [year, month] = date.split('-').map(Number) as [number, number];
  const start = (month >= 4 ? year : year - 1) - back;
  return [`${start}-04-01`, `${start + 1}-03-31`];
}

/**
 * Sales invoices and e-way bills as a PDF for the CA: one month, a date range or a
 * financial year, for every party or one, with totals, GST rate-wise and party-wise summaries.
 */
export default function ReportsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const { invoices: sales, purchases, ewbs } = useScopedRecords();
  const pdf = usePdfActions();
  const [kind, setKind] = useState<ReportFilter['kind']>('both');
  const [mode, setMode] = useState<'month' | 'range'>('month');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [from, setFrom] = useState(financialYear(today())[0]);
  const [to, setTo] = useState(today());
  const [party, setParty] = useState('');
  const [picker, setPicker] = useState(false);
  /** One document type ('' = every type); tax invoices unless the user picks another. */
  const [documentType, setDocumentType] = useState('Tax invoice');
  const [busy, setBusy] = useState<'download' | 'share' | null>(null);
  // The purchase report lists your purchase bills; the others, your sales invoices.
  const purchase = kind === 'purchase';
  const invoices = purchase ? purchases : sales;

  // Months that have invoices or e-way bills (newest first), plus the current month.
  const months = useMemo(() => {
    const set = new Set<string>([today().slice(0, 7)]);
    for (const invoice of invoices) if (invoice.invoiceDate) set.add(invoice.invoiceDate.slice(0, 7));
    for (const ewb of ewbs) set.add(new Date(Date.parse(ewb.generatedAt) + 330 * 60_000).toISOString().slice(0, 7));
    return [...set].sort().reverse().slice(0, 24);
  }, [invoices, ewbs]);

  const parties = useMemo(() => {
    const names = new Map<string, string>();
    for (const invoice of invoices) {
      const name = partyOf(invoice).name.trim();
      if (name) names.set(name.toLowerCase(), name);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [invoices]);

  const rangeOk = mode === 'month' || (VALID_DATE.test(from) && VALID_DATE.test(to) && from <= to);
  const filter: ReportFilter = mode === 'month' ? { from: `${month}-01`, to: monthEnd(month), party, documentType, kind } : { from, to, party, documentType, kind };
  const periodLabel = mode === 'month' ? monthLabel(month) : `${dateLabel(from)} – ${dateLabel(to)}`;
  const chosenInvoices = useMemo(() => (rangeOk ? reportInvoices(invoices, filter) : []), [invoices, rangeOk, filter.from, filter.to, filter.party, filter.documentType]);
  const showEwbs = kind === 'ewb' || kind === 'both';
  const chosenEwbs = useMemo(() => (rangeOk && showEwbs ? reportEwbs(ewbs, filter) : []), [ewbs, rangeOk, showEwbs, filter.from, filter.to, filter.party, filter.documentType]);
  const summary = salesSummary(chosenInvoices);
  const empty = (kind !== 'ewb' ? chosenInvoices.length : 0) + chosenEwbs.length === 0;

  const fileLabel = () => {
    const what = kind === 'sales' ? 'Sales report' : purchase ? 'Purchase report' : kind === 'ewb' ? 'EWB report' : 'Sales & EWB report';
    const when = mode === 'month' ? month : `${from} to ${to}`;
    return `${what} ${when}${party ? ` ${party}` : ''}${documentType ? ` ${documentType}` : ''}`;
  };

  const run = async (action: 'download' | 'share') => {
    setBusy(action);
    try {
      await pdf[action](reportHtml(store.business, chosenInvoices, chosenEwbs, filter, periodLabel), fileLabel());
    } finally {
      setBusy(null);
    }
  };

  const setRange = ([start, end]: [string, string]) => {
    setFrom(start);
    setTo(end > today() ? today() : end);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Reports" subtitle="Sales, purchases & e-way bills as PDF for your CA" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled">
        <SectionTitle title="Report" />
        <Segmented value={kind} onChange={(value) => { setKind(value); setParty(''); }} options={[{ value: 'both', label: 'Both' }, { value: 'sales', label: 'Sales' }, { value: 'purchase', label: 'Purchase' }, { value: 'ewb', label: 'E-way bills' }]} />

        <SectionTitle title="Period" />
        <Segmented value={mode} onChange={setMode} options={[{ value: 'month', label: 'Month' }, { value: 'range', label: 'Date range' }]} />
        {mode === 'month' ? (
          <ChipRow>
            {months.map((item) => <Chip key={item} label={monthLabel(item)} selected={month === item} onPress={() => setMonth(item)} />)}
          </ChipRow>
        ) : (
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label="From" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" maxLength={10} /></View>
              <View style={{ flex: 1 }}><Field label="To" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" maxLength={10} /></View>
            </View>
            <ChipRow>
              <Chip label="This FY" selected={false} onPress={() => setRange(financialYear(today()))} />
              <Chip label="Last FY" selected={false} onPress={() => setRange(financialYear(today(), 1))} />
              <Chip label="Last 3 months" selected={false} onPress={() => {
                const start = new Date(Date.now() + 330 * 60_000);
                start.setUTCMonth(start.getUTCMonth() - 2, 1);
                setRange([start.toISOString().slice(0, 10), today()]);
              }} />
            </ChipRow>
            {!rangeOk ? <TextBlock size={12} color={colors.dangerForeground}>Enter both dates as YYYY-MM-DD, with From before To.</TextBlock> : null}
          </Card>
        )}

        <SectionTitle title="Party" />
        <ChipRow>
          <Chip label={party || 'All parties'} icon="users" selected={Boolean(party)} onPress={() => setPicker(true)} />
          {party ? <Chip label="All parties" icon="x" selected={false} onPress={() => setParty('')} /> : null}
        </ChipRow>

        <SectionTitle title="Document type" />
        <ChipRow>
          {['', ...DOCUMENT_TYPES].map((type) => <Chip key={type || 'all'} label={type || 'All types'} selected={documentType === type} onPress={() => setDocumentType(type)} />)}
        </ChipRow>

        <SectionTitle title="Summary" />
        <Card style={{ gap: 8 }}>
          <TextBlock size={13} weight="semibold">{periodLabel}{party ? ` · ${party}` : ''}{documentType ? ` · ${documentType}` : ''}</TextBlock>
          {kind !== 'ewb' ? (
            <>
              <KeyValue label={purchase ? 'Purchase bills' : 'Invoices'} value={String(summary.count)} />
              <Divider />
              <KeyValue label="Taxable value" value={formatInr(summary.taxable)} />
              <Divider />
              <KeyValue label="GST (CGST + SGST + IGST)" value={formatInr(summary.cgst + summary.sgst + summary.igst)} />
              <Divider />
              <KeyValue label={purchase ? 'Total purchases' : 'Total sales'} value={formatInr(summary.total)} strong />
            </>
          ) : null}
          {showEwbs ? (
            <>
              {kind === 'both' ? <Divider /> : null}
              <KeyValue label="E-way bills" value={`${chosenEwbs.length}${chosenEwbs.some((ewb) => ewb.status === 'cancelled') ? ` (${chosenEwbs.filter((ewb) => ewb.status === 'cancelled').length} cancelled)` : ''}`} />
            </>
          ) : null}
          <TextBlock size={11} color={colors.mutedForeground}>{purchase ? 'The PDF lists every purchase bill with totals, and document type-wise, GST rate-wise and party-wise summaries.' : 'The PDF lists every invoice and e-way bill with totals, and document type-wise, GST rate-wise and party-wise summaries.'} Drafts are not included.</TextBlock>
        </Card>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 10 }]}>
        <Button title="Download PDF" icon="download" onPress={() => void run('download')} loading={busy === 'download'} disabled={!rangeOk || empty || busy !== null} style={{ flex: 1 }} testID="report-download" />
        <Button title="Share" icon="share-2" variant="outline" onPress={() => void run('share')} loading={busy === 'share'} disabled={!rangeOk || empty || busy !== null} style={{ flex: 1 }} testID="report-share" />
      </View>

      <SelectSheet
        visible={picker}
        onClose={() => setPicker(false)}
        title="Report for which party?"
        value={party}
        emptyText={purchase ? 'No purchases with a party yet.' : 'No invoices with a buyer yet.'}
        options={[{ value: '', label: 'All parties' }, ...parties.map((name) => ({ value: name, label: name }))]}
        onSelect={(value) => { setParty(value); setPicker(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, padding: 12, flexDirection: 'row', gap: 10 },
});
