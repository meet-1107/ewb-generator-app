import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useLoadMore } from '@/hooks/useLoadMore';
import { useDeleteInvoice } from '@/hooks/useDeleteInvoice';
import { formatRupees, invoiceTotals, type Invoice } from '@/lib/domain';
import { invoiceHtml, invoicePdfLabel, printHtml, shareHtmlAsPdf } from '@/lib/documents';
import { useAppStore, useScopedRecords } from '@/state/app-store';
import { Button, Card, Chip, ChipRow, EmptyState, Heading, IconButton, LoadMore, Page, SearchBar, SectionTitle, SelectSheet, TextBlock, TotalBanner } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import InvoiceCard from '@/components/InvoiceCard';

const PAGE = 20;

/** Purchase bills from your parties: the same list as sales invoices, with the party as the seller. */
export default function PurchasesScreen() {
  const colors = useColors();
  const store = useAppStore();
  const dialog = useDialog();
  const { purchases } = useScopedRecords();
  const [search, setSearch] = useState('');
  /** Party (seller) name to show purchases for ('' = every party). */
  const [party, setParty] = useState('');
  const [partyPicker, setPartyPicker] = useState(false);
  const list = useLoadMore(PAGE);
  const deleteInvoice = useDeleteInvoice();

  const parties = useMemo(() => {
    const byName = new Map<string, { name: string; count: number; total: number }>();
    for (const purchase of purchases) {
      const name = purchase.sellerName.trim();
      if (!name) continue;
      const entry = byName.get(name.toLowerCase()) ?? { name, count: 0, total: 0 };
      entry.count += 1;
      entry.total += invoiceTotals(purchase).total;
      byName.set(name.toLowerCase(), entry);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [purchases]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...purchases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((purchase) => {
      if (party && purchase.sellerName.trim().toLowerCase() !== party.toLowerCase()) return false;
      if (!query) return true;
      return [purchase.invoiceNumber, purchase.sellerName, purchase.sellerGstin, purchase.invoiceDate].some((value) => value.toLowerCase().includes(query));
    });
  }, [purchases, search, party]);

  // Total purchase as on the dashboard: drafts are not counted.
  const saved = useMemo(() => purchases.filter((purchase) => purchase.status !== 'draft'), [purchases]);
  const total = filtered.reduce((sum, purchase) => sum + invoiceTotals(purchase).total, 0);
  const openPurchase = (purchase: Invoice) => router.push({ pathname: '/invoice/[id]', params: { id: purchase.id, view: '1' } });
  const addPurchase = () => router.push('/purchase/new');
  const importPdf = () => router.push({ pathname: '/invoice/import', params: { kind: 'purchase' } });

  const actions = async (purchase: Invoice) => {
    const choice = await dialog.prompt({
      title: purchase.invoiceNumber || 'Purchase bill',
      message: 'Choose an action for this purchase.',
      choices: ['Open', 'Edit purchase', 'Share as PDF', 'Print', 'Delete purchase'],
      confirmLabel: 'Continue',
    });
    if (!choice) return;
    if (choice.choice === 'Open') openPurchase(purchase);
    if (choice.choice === 'Edit purchase') router.push(`/invoice/${purchase.id}`);
    try {
      if (choice.choice === 'Share as PDF') await shareHtmlAsPdf(invoiceHtml(purchase), invoicePdfLabel(purchase));
      if (choice.choice === 'Print') await printHtml(invoiceHtml(purchase));
    } catch (error) {
      dialog.toast((error as Error).message || 'Could not open the document', 'danger');
    }
    if (choice.choice === 'Delete purchase') await deleteInvoice(purchase);
  };

  return (
    <Page contentStyle={styles.page} tab={false} onRefresh={() => void store.syncNow()} refreshing={store.syncState === 'syncing'} onEndReached={() => list.more(filtered.length)}>
      <View style={styles.top}>
        <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
      </View>
      <Heading
        eyebrow="My business"
        title="Purchase"
        subtitle={`${purchases.length} purchase bill${purchases.length === 1 ? '' : 's'}`}
      />
      <TotalBanner
        label="Total purchase"
        amount={formatRupees(saved.reduce((sum, purchase) => sum + invoiceTotals(purchase).total, 0))}
        detail={`${saved.length} bill${saved.length === 1 ? '' : 's'}${purchases.length > saved.length ? ` · ${purchases.length - saved.length} draft${purchases.length - saved.length === 1 ? '' : 's'} not counted` : ''}`}
        testID="purchase-total"
      />
      <SearchBar value={search} onChangeText={(value) => { setSearch(value); list.reset(); }} placeholder="Bill no., party, GSTIN or date" testID="purchase-search" />
      <ChipRow>
        <Chip label={party || 'Filter by party'} icon="users" selected={Boolean(party)} onPress={() => setPartyPicker(true)} />
        {party ? <Chip label="All parties" icon="x" selected={false} onPress={() => setParty('')} /> : null}
      </ChipRow>

      <View style={styles.quickActions}>
        <Button title="Add purchase" icon="plus" onPress={addPurchase} style={{ flex: 1.25 }} testID="purchase-new" />
        <Button title="Import PDF" icon="upload" variant="outline" onPress={importPdf} style={{ flex: 1 }} testID="purchase-import" />
      </View>

      <SectionTitle title={party ? `Purchases from ${party}` : search ? 'Matching purchases' : 'All purchases'} count={filtered.length} />
      {filtered.length ? (
        <View style={{ gap: 10 }}>
          {party ? <TextBlock size={12} color={colors.mutedForeground}>{filtered.length} bill{filtered.length === 1 ? '' : 's'} · {formatRupees(total)}</TextBlock> : null}
          {filtered.slice(0, list.limit).map((purchase) => (
            <InvoiceCard key={purchase.id} invoice={purchase} onPress={() => openPurchase(purchase)} onLongPress={() => void actions(purchase)} onMore={() => void actions(purchase)} />
          ))}
          <LoadMore remaining={filtered.length - list.limit} loading={list.loading} onPress={() => list.more(filtered.length)} noun="more purchases" />
        </View>
      ) : (
        <Card>
          <EmptyState
            icon={search || party ? 'search' : 'shopping-cart'}
            title={search || party ? 'No matching purchases' : 'No purchases yet'}
            body={search || party ? 'Try a different search or clear the filter.' : 'Add a purchase bill from a party, or import its PDF to start without typing.'}
            action={search || party
              ? <Button title="Clear filters" variant="outline" onPress={() => { setSearch(''); setParty(''); }} />
              : <Button title="Add purchase entry" icon="plus" onPress={addPurchase} />}
          />
        </Card>
      )}

      <SelectSheet
        visible={partyPicker}
        onClose={() => setPartyPicker(false)}
        title="Purchases from which party?"
        value={party}
        emptyText="No purchases with a party yet."
        options={[{ value: '', label: 'All parties', detail: `${purchases.length} purchases` }, ...parties.map((item) => ({ value: item.name, label: item.name, detail: `${item.count} bill${item.count === 1 ? '' : 's'} · ${formatRupees(item.total)}` }))]}
        onSelect={(value) => { setParty(value); list.reset(); setPartyPicker(false); }}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  top: { flexDirection: 'row' },
  quickActions: { flexDirection: 'row', gap: 10 },
});
