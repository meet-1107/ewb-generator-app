import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { templates, type InvoiceStatus } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';
import { Button, Card, EmptyState, Field, Heading, Page, SectionTitle, TextBlock } from '@/components/AppUI';
import InvoiceCard from '@/components/InvoiceCard';

const filters: { label: string; value: InvoiceStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Ready', value: 'ready' },
  { label: 'EWB generated', value: 'ewb_generated' },
];

export default function InvoicesScreen() {
  const colors = useColors();
  const { invoices, removeInvoice } = useAppStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterGstin, setFilterGstin] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const matchesFilter = filter === 'all' || invoice.status === filter;
      const matchesFrom = !dateFrom || invoice.invoiceDate >= dateFrom;
      const matchesTo = !dateTo || invoice.invoiceDate <= dateTo;
      const matchesGstin = !filterGstin || invoice.sellerGstin.toUpperCase().includes(filterGstin.trim().toUpperCase());
      const matchesQuery = !query || [
        invoice.invoiceNumber,
        invoice.buyerName,
        invoice.buyerGstin,
        invoice.sellerGstin,
        invoice.invoiceDate,
      ].some((value) => value.toLowerCase().includes(query));
      return matchesFilter && matchesQuery && matchesFrom && matchesTo && matchesGstin;
    });
  }, [invoices, search, filter, dateFrom, dateTo, filterGstin]);

  const confirmDelete = (invoiceId: string) => {
    Alert.alert('Delete this draft?', 'This removes the unsubmitted draft saved on this device. This cannot be undone.', [
      { text: 'Keep draft', style: 'cancel' },
      { text: 'Delete draft', style: 'destructive', onPress: () => void removeInvoice(invoiceId) },
    ]);
  };

  return (
    <Page contentStyle={styles.page}>
      <View style={styles.head}>
        <Heading eyebrow="Your paperwork" title="Invoices" subtitle={`${invoices.length} saved ${invoices.length === 1 ? 'invoice' : 'invoices'}`} />
        <Pressable style={[styles.add, { backgroundColor: colors.primary }]} onPress={() => setShowTemplates((current) => !current)} accessibilityLabel="New invoice">
          <Feather name="plus" size={19} color="#fff" />
        </Pressable>
      </View>
      <View style={[styles.search, { borderColor: colors.input, backgroundColor: colors.card }]}>
        <Feather name="search" size={17} color={colors.mutedForeground} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Invoice, buyer, GSTIN or date" placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground }]} returnKeyType="search" accessibilityLabel="Search invoices" />
        {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Feather name="x-circle" size={17} color={colors.mutedForeground} /></Pressable> : null}
        <Pressable onPress={() => setShowFilters((current) => !current)} style={{ paddingLeft: 9 }} accessibilityLabel="Toggle invoice filters"><Feather name="sliders" size={18} color={showFilters ? colors.primary : colors.mutedForeground} /></Pressable>
      </View>
      {showFilters ? (
        <Card>
          <TextBlock size={13} weight="semibold">Additional filters</TextBlock>
          <View style={styles.dateFields}>
            <View style={{ flex: 1 }}><Field label="From date" value={dateFrom} onChangeText={setDateFrom} placeholder="YYYY-MM-DD" /></View>
            <View style={{ flex: 1 }}><Field label="To date" value={dateTo} onChangeText={setDateTo} placeholder="YYYY-MM-DD" /></View>
          </View>
          <Field label="Issuing GSTIN" value={filterGstin} onChangeText={setFilterGstin} placeholder="Filter by seller GSTIN" autoCapitalize="characters" />
          <Pressable onPress={() => { setDateFrom(''); setDateTo(''); setFilterGstin(''); setFilter('all'); setSearch(''); }}><TextBlock size={12} weight="semibold" color={colors.primary}>Clear all filters</TextBlock></Pressable>
        </Card>
      ) : null}
      <View style={styles.chips}>
        {filters.map((item) => {
          const selected = filter === item.value;
          return <Pressable key={item.value} onPress={() => setFilter(item.value)} style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}><TextBlock size={12} weight="semibold" color={selected ? '#fff' : colors.mutedForeground}>{item.label}</TextBlock></Pressable>;
        })}
      </View>
      {showTemplates ? (
        <Card>
          <SectionTitle title="Choose a layout" action="Close" onPress={() => setShowTemplates(false)} />
          <TextBlock size={12} color={colors.mutedForeground}>Layouts change presentation only. They are not pre-approved legal formats.</TextBlock>
          <View style={styles.templateGrid}>
            {templates.map((template, index) => (
              <Pressable key={template.id} onPress={() => router.push({ pathname: '/invoice/new', params: { templateId: template.id } })} style={[styles.template, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <View style={[styles.templateIcon, { backgroundColor: index % 2 === 0 ? colors.accent : '#f7eddc' }]}><Feather name={index === 4 ? 'truck' : 'file-text'} size={16} color={index % 2 === 0 ? colors.primary : '#8a6533'} /></View>
                <TextBlock size={13} weight="semibold">{template.name}</TextBlock>
                <TextBlock size={10} color={colors.mutedForeground}>{template.note}</TextBlock>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}
      {!showTemplates ? (
        <View style={styles.quickActions}>
          <Button title="New invoice" icon="plus" onPress={() => setShowTemplates(true)} />
          <Button title="Import PDF" icon="upload" secondary onPress={() => router.push('/invoice/import')} />
        </View>
      ) : null}
      <SectionTitle title={search || filter !== 'all' ? 'Matching invoices' : 'Saved invoices'} />
      {filtered.length ? (
        <View style={{ gap: 10 }}>
          {filtered.map((invoice) => (
            <View key={invoice.id}>
              <InvoiceCard invoice={invoice} onPress={() => router.push(`/invoice/${invoice.id}`)} />
              {invoice.status === 'draft' ? (
                <Pressable onPress={() => confirmDelete(invoice.id)} style={styles.deleteLink}><Feather name="trash-2" size={13} color={colors.destructive} /><TextBlock size={11} color={colors.destructive}>Delete draft</TextBlock></Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Card><EmptyState icon={search ? 'search' : 'file-plus'} title={search ? 'No matching invoices' : 'Start with an invoice'} body={search ? 'Try a different invoice number, buyer, GSTIN or date.' : 'Choose a layout to create a draft. Review every value before using it for an e-way bill.'} action={!search ? <Button title="Choose a layout" onPress={() => setShowTemplates(true)} /> : undefined} /></Card>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 17, paddingTop: 18 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  add: { height: 43, width: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  search: { borderWidth: 1, borderRadius: 15, height: 51, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', paddingVertical: 10 },
  dateFields: { flexDirection: 'row', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 99 },
  quickActions: { gap: 9 },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  template: { width: '48%', flexGrow: 1, borderWidth: 1, borderRadius: 15, padding: 12, gap: 6, minHeight: 98 },
  templateIcon: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  deleteLink: { paddingVertical: 9, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
});
