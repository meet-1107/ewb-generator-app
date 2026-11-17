import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Chip, ChipRow, EmptyState, Heading, IconButton, LoadMore, Page, SearchBar, SectionTitle } from '@/components/AppUI';
import { BalanceHero, MoneyRow, RowsCard } from '@/components/LedgerUI';
import { useLoadMore } from '@/hooks/useLoadMore';
import { formatDate, formatInr, today } from '@/lib/domain';
import { partySummaries, scopedEntries } from '@/lib/ledger';
import { useAppStore, useScopedRecords } from '@/state/app-store';

type Filter = 'all' | 'receive' | 'pay' | 'settled';
const PAGE = 30;

/** Account → My business → Party ledger: what each party owes you, or you owe them. */
export default function PartyLedgerScreen() {
  const store = useAppStore();
  const { invoices, purchases } = useScopedRecords();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useLoadMore(PAGE);

  const parties = useMemo(() => partySummaries([...invoices, ...purchases], scopedEntries(store.entries, store.activeGstin)), [invoices, purchases, store.entries, store.activeGstin]);
  const toReceive = parties.reduce((sum, party) => sum + Math.max(0, party.balance), 0);
  const toPay = parties.reduce((sum, party) => sum + Math.max(0, -party.balance), 0);
  const query = search.trim().toLowerCase();
  const shown = parties.filter((party) => {
    if (filter === 'receive' && party.balance <= 0) return false;
    if (filter === 'pay' && party.balance >= 0) return false;
    if (filter === 'settled' && party.balance !== 0) return false;
    return !query || party.name.toLowerCase().includes(query) || party.gstin.toLowerCase().includes(query);
  });

  return (
    <Page contentStyle={styles.page} tab={false} onRefresh={() => void store.syncNow()} refreshing={store.syncState === 'syncing'} onEndReached={() => list.more(shown.length)}>
      <View style={styles.top}><IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} /></View>
      <Heading eyebrow="My business" title="Party ledger" subtitle={`${parties.length} part${parties.length === 1 ? 'y' : 'ies'}`} />
      <BalanceHero label={`Outstanding · as on ${formatDate(today())}`} split={[{ label: 'To receive', value: formatInr(toReceive) }, { label: 'To pay', value: formatInr(toPay) }]} testID="ledger-total" />
      <SearchBar value={search} onChangeText={(value) => { setSearch(value); list.reset(); }} placeholder="Party name or GSTIN" testID="ledger-search" />
      <ChipRow>
        {([['all', 'All'], ['receive', 'To receive'], ['pay', 'To pay'], ['settled', 'Settled']] as const).map(([value, label]) => (
          <Chip key={value} label={label} selected={filter === value} onPress={() => { setFilter(value); list.reset(); }} />
        ))}
      </ChipRow>
      <SectionTitle title={filter === 'all' ? 'All parties' : filter === 'receive' ? 'To receive' : filter === 'pay' ? 'To pay' : 'Settled'} count={shown.length} />
      {shown.length ? (
        <View style={{ gap: 8 }}>
          <RowsCard>
            {shown.slice(0, list.limit).map((party) => (
              <MoneyRow
                key={party.key}
                icon={party.balance > 0 ? 'arrow-down-left' : party.balance < 0 ? 'arrow-up-right' : 'check'}
                tone={party.balance > 0 ? 'in' : party.balance < 0 ? 'out' : 'neutral'}
                title={party.name}
                detail={[party.gstin, party.invoices ? `${party.invoices} invoice${party.invoices === 1 ? '' : 's'}` : '', party.bills ? `${party.bills} bill${party.bills === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'Payments only'}
                amount={formatInr(Math.abs(party.balance))}
                amountTone={party.balance > 0 ? 'in' : party.balance < 0 ? 'out' : undefined}
                sub={party.balance > 0 ? 'To receive' : party.balance < 0 ? 'To pay' : 'Settled'}
                onPress={() => router.push({ pathname: '/ledger/[key]', params: { key: party.key } })}
              />
            ))}
          </RowsCard>
          <LoadMore remaining={shown.length - list.limit} loading={list.loading} onPress={() => list.more(shown.length)} noun="more parties" />
        </View>
      ) : (
        <Card>
          <EmptyState icon="book-open" title={parties.length ? 'No matching parties' : 'No parties yet'} body="The ledger fills in by itself: sales invoices are amounts to receive, purchase bills amounts to pay, and payments in Bank or Cash entry clear them." />
        </Card>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  top: { flexDirection: 'row' },
});
