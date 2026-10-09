import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { newInvoice, templates, uid, type Invoice, type InvoiceStatus } from '@/lib/domain';
import { useAppStore, useScopedRecords } from '@/state/app-store';
import { Button, Card, Chip, ChipRow, EmptyState, Field, Heading, IconButton, Page, SearchBar, SectionTitle, Sheet, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import InvoiceCard from '@/components/InvoiceCard';

const PAGE = 20;
const filters: { label: string; value: InvoiceStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Ready', value: 'ready' },
  { label: 'EWB generated', value: 'ewb_generated' },
];

export default function InvoicesScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ status?: string; period?: string }>();
  const store = useAppStore();
  const dialog = useDialog();
  const { invoices } = useScopedRecords();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sheet, setSheet] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (params.status && filters.some((item) => item.value === params.status)) setFilter(params.status as InvoiceStatus);
    if (params.period && /^\d{4}-\d{2}$/.test(params.period)) {
      setDateFrom(`${params.period}-01`);
      setDateTo(`${params.period}-31`);
    }
  }, [params.status, params.period]);

  const counts = useMemo(() => ({
    all: invoices.length,
    draft: invoices.filter((item) => item.status === 'draft').length,
    ready: invoices.filter((item) => item.status === 'ready').length,
    ewb_generated: invoices.filter((item) => item.status === 'ewb_generated').length,
  }), [invoices]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (filter !== 'all' && invoice.status !== filter) return false;
      if (dateFrom && invoice.invoiceDate < dateFrom) return false;
      if (dateTo && invoice.invoiceDate > dateTo) return false;
      if (!query) return true;
      return [invoice.invoiceNumber, invoice.buyerName, invoice.buyerGstin, invoice.sellerGstin, invoice.invoiceDate, invoice.ewbNumber ?? '']
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [invoices, search, filter, dateFrom, dateTo]);

  const dateFiltered = Boolean(dateFrom || dateTo);

  const actions = async (invoice: Invoice) => {
    const choice = await dialog.prompt({
      title: invoice.invoiceNumber || 'Untitled invoice',
      message: 'Choose an action for this invoice.',
      choices: invoice.status === 'draft' ? ['Open', 'Duplicate as new draft', 'Delete draft'] : ['Open', 'Duplicate as new draft'],
      confirmLabel: 'Continue',
    });
    if (!choice) return;
    if (choice.choice === 'Open') router.push(`/invoice/${invoice.id}`);
    if (choice.choice === 'Duplicate as new draft') {
      const fresh = newInvoice(invoice.templateId);
      const { revisionHistory: _h, ...rest } = invoice;
      const copy: Invoice = { ...rest, ...{ id: fresh.id, createdAt: fresh.createdAt, updatedAt: fresh.updatedAt, invoiceDate: fresh.invoiceDate }, invoiceNumber: '', status: 'draft', ewbId: undefined, ewbNumber: undefined, idempotencyKey: undefined, extraction: undefined, sourceFileName: undefined, revisionHistory: [], lines: invoice.lines.map((line) => ({ ...line, id: uid('l') })) };
      await store.saveInvoice(copy);
      dialog.toast('Copied as a new draft', 'success');
      router.push(`/invoice/${copy.id}`);
    }
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
        subtitle={`${invoices.length} saved · ${counts.ready} ready for e-way bill`}
        right={<IconButton icon="upload" accessibilityLabel="Import invoice PDF" onPress={() => router.push('/invoice/import')} filled />}
      />
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
        {filters.map((item) => (
          <Chip key={item.value} label={item.label} count={counts[item.value]} selected={filter === item.value} onPress={() => { setFilter(item.value); setLimit(PAGE); }} />
        ))}
        {dateFiltered ? <Chip label={`${dateFrom || '…'} → ${dateTo || '…'}`} icon="x" selected={false} onPress={() => { setDateFrom(''); setDateTo(''); }} /> : null}
      </ChipRow>

      <SectionTitle title="Start from a layout" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templates} style={{ marginHorizontal: -20, flexGrow: 0 }}>
        {templates.map((template) => (
          <Pressable
            key={template.id}
            onPress={() => router.push({ pathname: '/invoice/new', params: { templateId: template.id } })}
            style={({ pressed }) => [styles.template, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            accessibilityRole="button"
            accessibilityLabel={`Use ${template.name} template. ${template.note}`}
            testID={`template-${template.id}`}
          >
            <TemplatePreview accent={template.accent} id={template.id} />
            <TextBlock size={14} weight="semibold">{template.name}</TextBlock>
            <TextBlock size={11} color={colors.mutedForeground} numberOfLines={2}>{template.note}</TextBlock>
            <TextBlock size={12} weight="semibold" color={colors.primary}>Use template →</TextBlock>
          </Pressable>
        ))}
      </ScrollView>
      <TextBlock size={11} color={colors.mutedForeground} style={{ marginTop: -8 }}>Layouts change how the invoice looks, not its legal content.</TextBlock>

      <View style={styles.quickActions}>
        <Button title="New invoice" icon="plus" onPress={() => router.push({ pathname: '/invoice/new', params: { templateId: store.business?.defaultTemplateId ?? 'classic' } })} style={{ flex: 1 }} testID="invoices-new" />
        <Button title="Import PDF" icon="upload" variant="outline" onPress={() => router.push('/invoice/import')} style={{ flex: 1 }} />
      </View>

      <SectionTitle title={search || filter !== 'all' || dateFiltered ? 'Matching invoices' : 'All invoices'} count={filtered.length} />
      {filtered.length ? (
        <View style={{ gap: 10 }}>
          {filtered.slice(0, limit).map((invoice) => (
            <InvoiceCard key={invoice.id} invoice={invoice} onPress={() => router.push(`/invoice/${invoice.id}`)} onLongPress={() => void actions(invoice)} />
          ))}
          {filtered.length > limit ? <Button title={`Show more (${filtered.length - limit})`} variant="outline" onPress={() => setLimit((current) => current + PAGE)} /> : null}
          <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center' }}>Tip: long-press an invoice to duplicate or delete it.</TextBlock>
        </View>
      ) : (
        <Card>
          <EmptyState
            icon={search || filter !== 'all' ? 'search' : 'file-plus'}
            title={search || filter !== 'all' || dateFiltered ? 'No matching invoices' : 'No invoices yet'}
            body={search || filter !== 'all' || dateFiltered ? 'Try a different search or clear the filters.' : 'Pick a layout above, or import a PDF to start without typing.'}
            action={search || filter !== 'all' || dateFiltered
              ? <Button title="Clear filters" variant="outline" onPress={() => { setSearch(''); setFilter('all'); setDateFrom(''); setDateTo(''); }} />
              : <Button title="Create invoice" icon="plus" onPress={() => router.push('/invoice/new')} />}
          />
        </Card>
      )}

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Filter invoices" subtitle="Filters apply together with search and status."
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

/** Tiny visual hint of each layout's structure. */
function TemplatePreview({ accent, id }: { accent: string; id: string }) {
  const colors = useColors();
  const bar = (width: `${number}%`, color = colors.border, height = 4) => <View style={{ width, height, borderRadius: 2, backgroundColor: color }} />;
  return (
    <View style={[styles.preview, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: id === 'minimal' ? colors.mutedForeground : accent, width: '55%' }} />
      {id === 'dispatch' ? <View style={[styles.previewBlock, { backgroundColor: `${accent}33` }]} /> : null}
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <View style={{ flex: 1, gap: 3 }}>{bar('90%')}{bar('70%')}</View>
        {id !== 'minimal' ? <View style={{ flex: 1, gap: 3 }}>{bar('90%')}{bar('60%')}</View> : null}
      </View>
      <View style={{ height: 5, borderRadius: 2, backgroundColor: id === 'minimal' ? colors.border : accent, opacity: 0.85 }} />
      {Array.from({ length: id === 'compact' ? 5 : 3 }).map((_, index) => <View key={index}>{bar(index % 2 ? '85%' : '100%', colors.border, id === 'compact' ? 2 : 3)}</View>)}
      {id === 'tax-summary' ? <View style={[styles.previewBlock, { backgroundColor: `${accent}22`, height: 10 }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  quickActions: { flexDirection: 'row', gap: 10 },
  templates: { gap: 10, paddingHorizontal: 20 },
  template: { width: 150, borderWidth: 1, borderRadius: 18, padding: 11, gap: 5 },
  preview: { height: 92, borderRadius: 10, borderWidth: 1, padding: 8, gap: 5, marginBottom: 4, overflow: 'hidden' },
  previewBlock: { height: 8, borderRadius: 3 },
});
