import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { formatInr, invoiceTotals, type Invoice } from '@/lib/domain';
import { useAppStore, useScopedRecords } from '@/state/app-store';
import { Button, Card, Chip, ChipRow, EmptyState, Field, Heading, Notice, Page, SearchBar, SectionTitle, SelectSheet, Sheet, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import InvoiceCard from '@/components/InvoiceCard';
import { AccountButton } from '@/components/Brand';

const PAGE = 20;

export default function InvoicesScreen() {
  const colors = useColors();
  // for=ewb: opened from "New e-way bill" on the E-way bills tab.
  const params = useLocalSearchParams<{ period?: string; from?: string; to?: string; for?: string }>();
  const store = useAppStore();
  const dialog = useDialog();
  const { invoices } = useScopedRecords();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /** Buyer name to show invoices for ('' = every party). */
  const [party, setParty] = useState('');
  const [partyPicker, setPartyPicker] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (params.period && /^\d{4}-\d{2}$/.test(params.period)) {
      setDateFrom(`${params.period}-01`);
      setDateTo(`${params.period}-31`);
    }
    if (params.from && params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.from) && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
      setDateFrom(params.from);
      setDateTo(params.to);
    }
  }, [params.period, params.from, params.to]);

  const pending = useMemo(() => invoices.filter((item) => item.status === 'ready' && item.ewbRequired !== false).length, [invoices]);

  // Parties that have invoices, with how many each.
  const parties = useMemo(() => {
    const byName = new Map<string, { name: string; count: number; total: number }>();
    for (const invoice of invoices) {
      const name = invoice.buyerName.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const entry = byName.get(key) ?? { name, count: 0, total: 0 };
      entry.count += 1;
      entry.total += invoiceTotals(invoice).total;
      byName.set(key, entry);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices]);

  // Every invoice, newest first.
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((invoice) => {
      if (party && invoice.buyerName.trim().toLowerCase() !== party.toLowerCase()) return false;
      if (dateFrom && invoice.invoiceDate < dateFrom) return false;
      if (dateTo && invoice.invoiceDate > dateTo) return false;
      if (!query) return true;
      return [invoice.invoiceNumber, invoice.buyerName, invoice.buyerGstin, invoice.sellerGstin, invoice.invoiceDate, invoice.ewbNumber ?? '']
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [invoices, search, dateFrom, dateTo, party]);

  const dateFiltered = Boolean(dateFrom || dateTo);

  // Saved invoices open as a preview (only Generate EWB there); drafts open in the editor.
  const openInvoice = (invoice: Invoice) => router.push({ pathname: '/invoice/[id]', params: { id: invoice.id, view: '1' } });

  const actions = async (invoice: Invoice) => {
    const choice = await dialog.prompt({
      title: invoice.invoiceNumber || 'Untitled invoice',
      message: 'Choose an action for this invoice.',
      choices: invoice.status === 'draft' ? ['Open', 'Delete draft'] : ['Open', 'Edit invoice'],
      confirmLabel: 'Continue',
    });
    if (!choice) return;
    if (choice.choice === 'Open') openInvoice(invoice);
    if (choice.choice === 'Edit invoice') router.push(`/invoice/${invoice.id}`);
    if (choice.choice === 'Delete draft') {
      const ok = await dialog.confirm({ title: 'Delete this draft?', message: 'This removes the unsubmitted draft from all your devices. This cannot be undone.', confirmLabel: 'Delete draft', cancelLabel: 'Keep it', tone: 'danger', icon: 'trash-2' });
      if (ok) {
        await store.removeInvoice(invoice.id);
        dialog.toast('Draft deleted');
      }
    }
  };

  return (
    <Page contentStyle={styles.page} onRefresh={() => void store.syncNow()} refreshing={store.syncState === 'syncing'}>
      <Heading
        eyebrow="Sales"
        title="Invoices"
        subtitle={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}${pending ? ` · ${pending} e-way bill${pending === 1 ? '' : 's'} pending` : ''}`}
        right={<AccountButton />}
      />
      {params.for === 'ewb' ? (
        <Notice
          tone="info"
          title="Choose the invoice for the e-way bill"
          body={pending
            ? `${pending} invoice${pending === 1 ? ' has' : 's have'} an e-way bill pending: open one and tap Generate EWB. For a new sale, create an invoice or import its PDF.`
            : 'Open a saved invoice and tap Generate EWB, or create a new invoice / import its PDF first.'}
          action="Got it"
          onAction={() => router.setParams({ for: undefined })}
        />
      ) : null}
      <SearchBar
        value={search}
        onChangeText={(value) => { setSearch(value); setLimit(PAGE); }}
        placeholder="Invoice no., buyer, GSTIN or date"
        testID="invoice-search"
        right={
          <Pressable onPress={() => setSheet(true)} hitSlop={10} style={{ paddingLeft: 6 }} accessibilityRole="button" accessibilityLabel="More filters">
            <Feather name="sliders" size={18} color={dateFiltered ? colors.primary : colors.mutedForeground} />
          </Pressable>
        }
      />
      <ChipRow>
        <Chip label={party || 'Filter by party'} icon="users" selected={Boolean(party)} onPress={() => setPartyPicker(true)} />
        {party ? <Chip label="All parties" icon="x" selected={false} onPress={() => setParty('')} /> : null}
        {dateFiltered ? <Chip label={`${dateFrom || '…'} → ${dateTo || '…'}`} icon="x" selected={false} onPress={() => { setDateFrom(''); setDateTo(''); }} /> : null}
      </ChipRow>
      {party ? (
        <Card style={styles.partySummary}>
          <View style={{ flex: 1, gap: 2 }}>
            <TextBlock size={15} weight="bold" numberOfLines={1}>{party}</TextBlock>
            <TextBlock size={12} color={colors.mutedForeground}>{filtered.length} invoice{filtered.length === 1 ? '' : 's'} · {formatInr(filtered.reduce((sum, invoice) => sum + invoiceTotals(invoice).total, 0))}</TextBlock>
          </View>
          <Button title="Change" size="sm" variant="outline" onPress={() => setPartyPicker(true)} />
        </Card>
      ) : null}

      <View style={styles.quickActions}>
        <Button title="New invoice" icon="plus" onPress={() => router.push({ pathname: '/invoice/new', params: { templateId: store.business?.defaultTemplateId ?? 'classic' } })} style={{ flex: 1 }} testID="invoices-new" />
        <Button title="Import PDF" icon="upload" variant="outline" onPress={() => router.push('/invoice/import')} style={{ flex: 1 }} />
      </View>

      <SectionTitle title={party ? `Invoices of ${party}` : search || dateFiltered || party ? 'Matching invoices' : 'All invoices'} count={filtered.length} />
      {filtered.length ? (
        <View style={{ gap: 10 }}>
          {filtered.slice(0, limit).map((invoice) => (
            <InvoiceCard key={invoice.id} invoice={invoice} onPress={() => openInvoice(invoice)} onLongPress={() => void actions(invoice)} />
          ))}
          {filtered.length > limit ? <Button title={`Show more (${filtered.length - limit})`} variant="outline" onPress={() => setLimit((current) => current + PAGE)} /> : null}
          <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center' }}>Tip: long-press an invoice to edit it or delete a draft.</TextBlock>
        </View>
      ) : (
        <Card>
          <EmptyState
            icon={search || dateFiltered || party ? 'search' : 'file-plus'}
            title={search || dateFiltered || party ? 'No matching invoices' : 'No invoices yet'}
            body={search || dateFiltered || party ? 'Try a different search or clear the filters.' : 'Create your first invoice, or import a PDF to start without typing.'}
            action={search || dateFiltered || party
              ? <Button title="Clear filters" variant="outline" onPress={() => { setSearch(''); setDateFrom(''); setDateTo(''); setParty(''); }} />
              : <Button title="Create invoice" icon="plus" onPress={() => router.push({ pathname: '/invoice/new', params: { templateId: store.business?.defaultTemplateId ?? 'classic' } })} />}
          />
        </Card>
      )}

      <SelectSheet
        visible={partyPicker}
        onClose={() => setPartyPicker(false)}
        title="Invoices of which party?"
        value={party}
        emptyText="No invoices with a buyer yet."
        options={[{ value: '', label: 'All parties', detail: `${invoices.length} invoices` }, ...parties.map((item) => ({ value: item.name, label: item.name, detail: `${item.count} invoice${item.count === 1 ? '' : 's'} · ${formatInr(item.total)}` }))]}
        onSelect={(value) => { setParty(value); setLimit(PAGE); setPartyPicker(false); }}
      />

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Filter invoices" subtitle="Filters apply together with search."
        footer={<View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Clear" variant="outline" onPress={() => { setDateFrom(''); setDateTo(''); }} style={{ flex: 1 }} />
          <Button title="Apply" onPress={() => setSheet(false)} style={{ flex: 1 }} />
        </View>}>
        <View style={{ paddingHorizontal: 18, gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="From" value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" maxLength={10} /></View>
            <View style={{ flex: 1 }}><Field label="To" value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" maxLength={10} /></View>
          </View>
          <ChipRow>
            {[['This month', 0], ['Last month', 1], ['Last 3 months', 3]].map(([label, offset]) => (
              <Chip key={label} label={String(label)} selected={false} onPress={() => {
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth() - Number(offset), 1);
                const end = offset === 1 ? new Date(now.getFullYear(), now.getMonth(), 0) : now;
                const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                setDateFrom(iso(start));
                setDateTo(iso(end));
              }} />
            ))}
          </ChipRow>
          <TextBlock size={11} color={colors.mutedForeground}>Showing invoices for GSTIN {store.activeGstin || 'all registrations'}. Switch registration from the Dashboard.</TextBlock>
        </View>
      </Sheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  quickActions: { flexDirection: 'row', gap: 10 },
  partySummary: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
});
