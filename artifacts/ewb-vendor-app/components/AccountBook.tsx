import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Chip, ChipRow, EmptyState, Heading, IconButton, LoadMore, MoneyField, Page, Sheet, TextBlock } from '@/components/AppUI';
import { DateField } from '@/components/DateField';
import { useDialog } from '@/components/Dialog';
import { draftFromEntry, EntrySheet, newDraft, type EntryDraft } from '@/components/EntrySheet';
import { BalanceHero, DateLabel, InOutButtons, MoneyRow, RowsCard } from '@/components/LedgerUI';
import { useColors } from '@/hooks/useColors';
import { useLoadMore } from '@/hooks/useLoadMore';
import { formatDate, formatInr, today } from '@/lib/domain';
import { accountBook, accountLabel, categoryIcon, CASH, inPeriod, periodRange, PERIODS, scopedEntries, type Entry, type Period } from '@/lib/ledger';
import { useAppStore } from '@/state/app-store';

const PAGE = 30;

/** Bank entry (one bank account at a time) or Cash entry: balance, money in / out, running balance per entry. */
export default function AccountBook({ mode }: { mode: 'bank' | 'cash' }) {
  const colors = useColors();
  const store = useAppStore();
  const dialog = useDialog();
  const banks = store.business?.bankAccounts ?? [];
  /** '' = every bank account together (the default). */
  const [bankId, setBankId] = useState('');
  const allBanks = mode === 'bank' && !bankId && banks.length > 1;
  const defaultBankId = banks.find((bank) => bank.id === store.business?.defaultBankId)?.id ?? banks[0]?.id ?? '';
  // The single account entries are added to: cash, the chosen bank, or (with all banks) the default bank.
  const account = mode === 'cash' ? CASH : bankId || defaultBankId;
  const shownAccounts = mode === 'cash' ? [CASH] : bankId ? [bankId] : banks.map((bank) => bank.id);
  const [period, setPeriod] = useState<Period>('all');
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [opening, setOpening] = useState<{ id?: string; createdAt?: string; amountPaise: number; date: string } | null>(null);
  const list = useLoadMore(PAGE);

  const entries = useMemo(() => scopedEntries(store.entries, store.activeGstin), [store.entries, store.activeGstin]);
  const accountsKey = shownAccounts.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const book = useMemo(() => (shownAccounts.length ? accountBook(entries, shownAccounts) : { rows: [], balance: 0 }), [entries, accountsKey]);
  const range = periodRange(period);
  const rows = book.rows.filter((row) => inPeriod(row.entry.date, range));
  const moneyIn = rows.reduce((sum, row) => sum + Math.max(0, row.effect), 0);
  const moneyOut = rows.reduce((sum, row) => sum + Math.max(0, -row.effect), 0);
  const openingEntry = entries.find((entry) => entry.kind === 'opening' && entry.account === account);
  const name = mode === 'cash' ? 'Cash' : allBanks ? 'All banks' : accountLabel(account, banks);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/account'));

  if (mode === 'bank' && !banks.length) {
    return (
      <Page contentStyle={styles.page} tab={false}>
        <View style={styles.top}><IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={back} /></View>
        <Heading eyebrow="My business" title="Bank entry" />
        <Card>
          <EmptyState icon="credit-card" title="Add your bank account first" body="Bank entries are kept for each bank account. Add the account once, then record money in and out." action={<Button title="Add bank account" icon="plus" onPress={() => router.push('/bank-details')} />} />
        </Card>
      </Page>
    );
  }

  // With all banks shown, each row also says which bank it belongs to.
  const describe = (entry: Entry) => {
    const info = describeIn(entry);
    if (!allBanks || entry.kind === 'transfer') return info;
    return { ...info, detail: [accountLabel(entry.account, banks), info.detail].filter(Boolean).join(' · ') };
  };
  const describeIn = (entry: Entry) => {
    if (entry.kind === 'opening') return { icon: 'flag' as const, tone: 'neutral' as const, title: 'Opening balance', detail: formatDate(entry.date) };
    if (entry.kind === 'transfer' && allBanks && entry.account !== CASH && entry.toAccount !== CASH) {
      return { icon: 'repeat' as const, tone: 'move' as const, title: 'Transfer between banks', detail: `${accountLabel(entry.account, banks)} → ${accountLabel(entry.toAccount ?? '', banks)}` };
    }
    if (entry.kind === 'transfer') {
      const account = shownAccounts.includes(entry.toAccount ?? '') ? entry.toAccount ?? '' : entry.account;
      const incoming = entry.toAccount === account;
      const other = accountLabel(incoming ? entry.account : entry.toAccount ?? '', banks);
      return { icon: 'repeat' as const, tone: 'move' as const, title: incoming ? (entry.account === CASH ? 'Cash deposited' : `From ${other}`) : entry.toAccount === CASH ? 'Cash withdrawn' : `To ${other}`, detail: [incoming ? `From ${other}` : `To ${other}`, entry.reference].filter(Boolean).join(' · ') };
    }
    if (entry.kind === 'expense') return { icon: categoryIcon(entry.category), tone: 'out' as const, title: entry.note || entry.category || 'Expense', detail: ['Expense', entry.category].filter(Boolean).join(' · ') };
    const incoming = entry.kind === 'receipt';
    return {
      icon: incoming ? 'arrow-down-left' as const : 'arrow-up-right' as const,
      tone: incoming ? 'in' as const : 'out' as const,
      title: entry.partyName || entry.note || (incoming ? 'Money in' : 'Money out'),
      detail: [mode === 'bank' ? entry.mode : '', entry.invoiceNumber ? `${incoming ? 'Inv' : 'Bill'} ${entry.invoiceNumber}` : '', entry.reference].filter(Boolean).join(' · ') || (incoming ? 'Received' : 'Paid'),
    };
  };

  const open = (entry: Entry) => {
    if (entry.kind === 'opening') return setOpening({ id: entry.id, createdAt: entry.createdAt, amountPaise: entry.amountPaise, date: entry.date });
    if (entry.kind === 'expense') return router.push({ pathname: '/expenses', params: { edit: entry.id } });
    setDraft(draftFromEntry(entry));
  };

  const saveOpening = async () => {
    if (!opening) return;
    await store.saveEntry({ id: opening.id, createdAt: opening.createdAt, kind: 'opening', account, amountPaise: opening.amountPaise, date: opening.date, gstin: store.activeGstin || undefined });
    setOpening(null);
    dialog.toast('Opening balance saved', 'success');
  };

  // Group the visible rows by date.
  const shown = rows.slice(0, list.limit);
  const groups: { date: string; items: typeof shown }[] = [];
  for (const row of shown) {
    const last = groups[groups.length - 1];
    if (last && last.date === row.entry.date) last.items.push(row);
    else groups.push({ date: row.entry.date, items: [row] });
  }

  return (
    <Page contentStyle={styles.page} tab={false} onRefresh={() => void store.syncNow()} refreshing={store.syncState === 'syncing'} onEndReached={() => list.more(rows.length)}>
      <View style={styles.top}><IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={back} /></View>
      <Heading eyebrow="My business" title={mode === 'cash' ? 'Cash entry' : 'Bank entry'} />
      <BalanceHero
        label={mode === 'cash' ? 'Cash in hand' : `${name} · balance`}
        amount={`${book.balance < 0 ? '−' : ''}${formatInr(Math.abs(book.balance))}`}
        detail={`As on ${formatDate(today())}`}
        split={[{ label: `In · ${range.label}`, value: `+${formatInr(moneyIn)}` }, { label: `Out · ${range.label}`, value: `−${formatInr(moneyOut)}` }]}
        action={openingEntry || allBanks ? undefined : 'Set opening'}
        onAction={() => setOpening({ amountPaise: 0, date: `${periodRange('fy').from}` })}
        testID={`${mode}-balance`}
      />
      {mode === 'bank' ? (
        <ChipRow>
          <Chip label="All banks" icon="credit-card" selected={!bankId} onPress={() => { setBankId(''); list.reset(); }} />
          {banks.map((bank) => <Chip key={bank.id} label={accountLabel(bank.id, banks)} selected={bank.id === bankId} onPress={() => { setBankId(bank.id); list.reset(); }} />)}
        </ChipRow>
      ) : null}
      <ChipRow>{PERIODS.map((item) => <Chip key={item.value} label={item.label} selected={period === item.value} onPress={() => { setPeriod(item.value); list.reset(); }} />)}</ChipRow>
      <InOutButtons
        inLabel={mode === 'cash' ? 'Cash in' : 'Money in'}
        outLabel={mode === 'cash' ? 'Cash out' : 'Money out'}
        inIcon={mode === 'cash' ? 'plus' : 'arrow-down-left'}
        outIcon={mode === 'cash' ? 'minus' : 'arrow-up-right'}
        onIn={() => setDraft(newDraft(account, 'receipt'))}
        onOut={() => setDraft(newDraft(account, 'payment'))}
        testID={mode}
      />
      {groups.length ? (
        <View style={{ gap: 8 }}>
          {groups.map((group) => (
            <View key={group.date} style={{ gap: 6 }}>
              <DateLabel>{formatDate(group.date)}</DateLabel>
              <RowsCard>
                {group.items.map(({ entry, effect, balance }) => {
                  const info = describe(entry);
                  return (
                    <MoneyRow
                      key={entry.id}
                      icon={info.icon}
                      tone={info.tone}
                      title={info.title}
                      detail={info.detail}
                      amount={`${effect >= 0 ? '+' : '−'}${formatInr(Math.abs(effect))}`}
                      amountTone={effect >= 0 ? 'in' : 'out'}
                      sub={`Bal ${balance < 0 ? '−' : ''}${formatInr(Math.abs(balance))}`}
                      onPress={() => open(entry)}
                    />
                  );
                })}
              </RowsCard>
            </View>
          ))}
          <LoadMore remaining={rows.length - list.limit} loading={list.loading} onPress={() => list.more(rows.length)} noun="more entries" />
        </View>
      ) : (
        <Card>
          <EmptyState
            icon={mode === 'cash' ? 'dollar-sign' : 'credit-card'}
            title={book.rows.length ? `No entries in ${range.label}` : 'No entries yet'}
            body={mode === 'cash' ? 'Record cash you receive and spend. Set the opening cash once to start from today’s cash in hand.' : 'Record payments received and made in this account. Set the opening balance once to match your passbook.'}
          />
        </Card>
      )}
      <TextBlock size={12} color={colors.mutedForeground} style={{ textAlign: 'center' }}>Expenses paid from {mode === 'cash' ? 'cash' : 'this bank'} show here too.</TextBlock>

      {/* With all banks shown, the form asks which bank (or cash) the money went through. */}
      <EntrySheet draft={draft} onClose={() => setDraft(null)} chooseAccount={allBanks} />

      <Sheet
        visible={Boolean(opening)}
        onClose={() => setOpening(null)}
        title={`Opening balance · ${name}`}
        subtitle={mode === 'cash' ? 'Cash in hand on the starting date' : 'Passbook balance on the starting date'}
        footer={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {opening?.id ? <Button title="Delete" variant="danger" style={{ flex: 1 }} onPress={() => { if (opening?.id) void store.removeEntry(opening.id).then(() => setOpening(null)); }} /> : null}
            <Button title="Save" style={{ flex: 2 }} onPress={() => void saveOpening()} />
          </View>
        )}
      >
        {opening ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            <MoneyField label="Opening balance" paise={opening.amountPaise} onChange={(amountPaise) => setOpening({ ...opening, amountPaise })} />
            <DateField label="As on" value={opening.date} onChange={(date) => setOpening({ ...opening, date })} />
          </View>
        ) : null}
      </Sheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  top: { flexDirection: 'row' },
});
