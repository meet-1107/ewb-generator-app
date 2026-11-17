import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Button, Card, Chip, ChipRow, EmptyState, Field, Heading, IconButton, LoadMore, MoneyField, Page, SectionTitle, Segmented, SelectField, Sheet, TextBlock } from '@/components/AppUI';
import { DateField } from '@/components/DateField';
import { useDialog } from '@/components/Dialog';
import { BalanceHero, MoneyRow, RowsCard } from '@/components/LedgerUI';
import { useColors } from '@/hooks/useColors';
import { useLoadMore } from '@/hooks/useLoadMore';
import { formatDate, formatInr, today } from '@/lib/domain';
import { accountLabel, CASH, categoryIcon, EXPENSE_CATEGORIES, gstIncluded, inPeriod, periodRange, PERIODS, scopedEntries, type Entry, type Period } from '@/lib/ledger';
import { useAppStore } from '@/state/app-store';

const PAGE = 30;
const GST_OPTIONS = [{ value: '0', label: 'No GST' }, { value: '5', label: 'GST 5% included' }, { value: '12', label: 'GST 12% included' }, { value: '18', label: 'GST 18% included' }, { value: '28', label: 'GST 28% included' }];
const BAR_COLORS = ['#175b42', '#e2a04a', '#5b8fc7', '#c1574a', '#8a6fb5', '#3f9a8a', '#b08a3c', '#9aa39c'];

type Draft = { id?: string; createdAt?: string; category: string; /** Typed name when the category is Other. */ customCategory: string; amountPaise: number; date: string; gstRate: string; account: string; note: string; reference: string };

/** Categories with a button; anything else was typed under Other. */
const BUILT_IN = new Set(EXPENSE_CATEGORIES.map((item) => item.value).filter((value) => value !== 'Other'));

const rateOf = (entry: Entry) => {
  if (!entry.gstPaise) return '0';
  const base = entry.amountPaise - entry.gstPaise;
  const rate = base > 0 ? Math.round((entry.gstPaise / base) * 100) : 0;
  return GST_OPTIONS.some((option) => option.value === String(rate)) ? String(rate) : '18';
};

/** Account → My business → Expenses: what the business spent, by category, paid from cash or a bank. */
export default function ExpensesScreen() {
  const colors = useColors();
  const store = useAppStore();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ edit?: string }>();
  const banks = store.business?.bankAccounts ?? [];
  const [period, setPeriod] = useState<Period>('month');
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const list = useLoadMore(PAGE);

  const expenses = useMemo(() => scopedEntries(store.entries, store.activeGstin).filter((entry) => entry.kind === 'expense').sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [store.entries, store.activeGstin]);
  const range = periodRange(period);
  const inRange = expenses.filter((entry) => inPeriod(entry.date, range));
  const shown = category ? inRange.filter((entry) => (entry.category || 'Other') === category) : inRange;
  const total = inRange.reduce((sum, entry) => sum + entry.amountPaise, 0);
  const gst = inRange.reduce((sum, entry) => sum + (entry.gstPaise ?? 0), 0);
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of inRange) map.set(entry.category || 'Other', (map.get(entry.category || 'Other') ?? 0) + entry.amountPaise);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [inRange]);
  // Category names typed under Other before, offered again as quick picks.
  const usedCustom = useMemo(() => [...new Set(expenses.map((entry) => entry.category ?? '').filter((name) => name && !BUILT_IN.has(name) && name !== 'Other'))].slice(0, 12), [expenses]);
  const accounts = [{ value: CASH, label: 'Cash' }, ...banks.map((bank) => ({ value: bank.id, label: accountLabel(bank.id, banks) }))];

  const openNew = () => { setErrors({}); setDraft({ category: '', customCategory: '', amountPaise: 0, date: today(), gstRate: '0', account: CASH, note: '', reference: '' }); };
  const openEdit = (entry: Entry) => {
    setErrors({});
    const typed = entry.category && !BUILT_IN.has(entry.category) && entry.category !== 'Other' ? entry.category : '';
    setDraft({ id: entry.id, createdAt: entry.createdAt, category: typed ? 'Other' : entry.category ?? 'Other', customCategory: typed, amountPaise: entry.amountPaise, date: entry.date, gstRate: rateOf(entry), account: entry.account || CASH, note: entry.note ?? '', reference: entry.reference ?? '' });
  };

  // Opened from Bank / Cash entry to edit an expense.
  useEffect(() => {
    if (!params.edit) return;
    const entry = store.entries.find((item) => item.id === params.edit);
    if (entry) openEdit(entry);
    router.setParams({ edit: undefined });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.edit]);

  const set = (patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setErrors((current) => { const next = { ...current }; for (const key of Object.keys(patch)) delete next[key]; return next; });
  };

  const save = async () => {
    if (!draft) return;
    const problems: Record<string, string> = {};
    if (!draft.category) problems.category = 'Choose a category';
    else if (draft.category === 'Other' && !draft.customCategory.trim()) problems.customCategory = 'Type what this expense is for, e.g. Diesel';
    if (draft.amountPaise <= 0) problems.amountPaise = 'Enter the amount';
    setErrors(problems);
    if (Object.keys(problems).length) return;
    const gstPaise = gstIncluded(draft.amountPaise, Number(draft.gstRate));
    await store.saveEntry({
      id: draft.id,
      createdAt: draft.createdAt,
      kind: 'expense',
      account: draft.account,
      amountPaise: draft.amountPaise,
      date: draft.date,
      category: draft.category === 'Other' ? draft.customCategory.trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()) : draft.category,
      ...(gstPaise ? { gstPaise } : {}),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
      gstin: store.activeGstin || undefined,
    });
    dialog.toast(draft.id ? 'Expense updated' : 'Expense saved', 'success');
    setDraft(null);
  };

  const remove = async () => {
    if (!draft?.id) return;
    const ok = await dialog.confirm({ title: 'Delete this expense?', message: `${formatInr(draft.amountPaise)} · ${draft.category} on ${formatDate(draft.date)}`, confirmLabel: 'Delete', tone: 'danger', icon: 'trash-2' });
    if (!ok) return;
    await store.removeEntry(draft.id);
    setDraft(null);
    dialog.toast('Expense deleted');
  };

  return (
    <Page contentStyle={styles.page} tab={false} onRefresh={() => void store.syncNow()} refreshing={store.syncState === 'syncing'} onEndReached={() => list.more(shown.length)}>
      <View style={styles.top}><IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/account'))} /></View>
      <Heading eyebrow="My business" title="Expenses" />
      <BalanceHero label={`Expenses · ${range.label}`} amount={formatInr(total)} detail={`${inRange.length} entr${inRange.length === 1 ? 'y' : 'ies'}${gst ? ` · GST input ${formatInr(gst)}` : ''}`} testID="expense-total" />
      <ChipRow>{PERIODS.map((item) => <Chip key={item.value} label={item.label} selected={period === item.value} onPress={() => { setPeriod(item.value); setCategory(''); list.reset(); }} />)}</ChipRow>

      {byCategory.length ? (
        <Card style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <TextBlock size={13} weight="bold">By category</TextBlock>
            {category ? <Pressable onPress={() => setCategory('')}><TextBlock size={12} weight="semibold" color={colors.primary}>Show all</TextBlock></Pressable> : <TextBlock size={12} color={colors.mutedForeground}>Tap to filter</TextBlock>}
          </View>
          <View style={[styles.bar, { backgroundColor: colors.border }]}>
            {byCategory.map(([name, amount], index) => <View key={name} style={{ flex: amount, backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }} />)}
          </View>
          <View style={styles.legend}>
            {byCategory.map(([name, amount], index) => (
              <Pressable key={name} onPress={() => { setCategory(category === name ? '' : name); list.reset(); }} style={[styles.legendItem, category === name && { backgroundColor: colors.secondary }]}>
                <View style={[styles.dot, { backgroundColor: BAR_COLORS[index % BAR_COLORS.length] }]} />
                <TextBlock size={12} color={category === name ? colors.foreground : colors.mutedForeground} weight={category === name ? 'semibold' : 'regular'}>{name} {formatInr(amount)}</TextBlock>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      <Button title="Add expense" icon="plus" onPress={openNew} testID="expense-add" />

      <SectionTitle title={category ? `${category} · ${range.label}` : range.label} count={shown.length} />
      {shown.length ? (
        <View style={{ gap: 8 }}>
          <RowsCard>
            {shown.slice(0, list.limit).map((entry) => (
              <MoneyRow
                key={entry.id}
                icon={categoryIcon(entry.category)}
                tone="out"
                title={entry.note || entry.category || 'Expense'}
                detail={[entry.category, accountLabel(entry.account, banks), formatDate(entry.date)].filter(Boolean).join(' · ')}
                amount={formatInr(entry.amountPaise)}
                sub={entry.gstPaise ? `GST ${formatInr(entry.gstPaise)}` : undefined}
                onPress={() => openEdit(entry)}
              />
            ))}
          </RowsCard>
          <LoadMore remaining={shown.length - list.limit} loading={list.loading} onPress={() => list.more(shown.length)} noun="more expenses" />
        </View>
      ) : (
        <Card><EmptyState icon="file-minus" title={expenses.length ? `No expenses in ${range.label}` : 'No expenses yet'} body="Record rent, salary, transport and other spending. Paid by cash, it comes out of Cash entry; paid by bank, out of that bank." /></Card>
      )}

      <Sheet
        visible={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit expense' : 'Add expense'}
        subtitle="Choose a category, then the amount"
        tall
        footer={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {draft?.id ? <Button title="Delete" variant="danger" onPress={() => void remove()} style={{ flex: 1 }} /> : null}
            <Button title="Save expense" onPress={() => void save()} style={{ flex: 2 }} testID="expense-save" />
          </View>
        )}
      >
        {draft ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            <View style={styles.grid}>
              {EXPENSE_CATEGORIES.map((item) => {
                const selected = draft.category === item.value;
                return (
                  <Pressable key={item.value} onPress={() => set({ category: item.value })} style={[styles.cat, { backgroundColor: selected ? colors.secondary : colors.card, borderColor: selected ? colors.primary : errors.category ? colors.destructive : colors.border, borderWidth: selected ? 2 : 1 }]} accessibilityRole="radio" accessibilityState={{ selected }}>
                    <Feather name={item.icon} size={18} color={selected ? colors.primary : colors.mutedForeground} />
                    <TextBlock size={11} weight={selected ? 'bold' : 'regular'} numberOfLines={1}>{item.value}</TextBlock>
                  </Pressable>
                );
              })}
            </View>
            {errors.category ? <TextBlock size={12} color={colors.dangerForeground}>{errors.category}</TextBlock> : null}
            {draft.category === 'Other' ? (
              <View style={{ gap: 8 }}>
                <Field
                  label="Category name"
                  required
                  value={draft.customCategory}
                  onChangeText={(customCategory) => set({ customCategory })}
                  placeholder="e.g. Diesel, Packing material, Stationery"
                  autoCapitalize="words"
                  maxLength={40}
                  error={errors.customCategory}
                  hint="Saved as its own category, so you can see this expense separately."
                  testID="expense-custom-category"
                />
                {usedCustom.length ? (
                  <ChipRow>{usedCustom.map((name) => <Chip key={name} label={name} selected={draft.customCategory.trim().toLowerCase() === name.toLowerCase()} onPress={() => set({ customCategory: name })} />)}</ChipRow>
                ) : null}
              </View>
            ) : null}
            <MoneyField label="Amount" required paise={draft.amountPaise} onChange={(amountPaise) => set({ amountPaise })} error={errors.amountPaise} hint={Number(draft.gstRate) && draft.amountPaise ? `GST in it: ${formatInr(gstIncluded(draft.amountPaise, Number(draft.gstRate)))}` : undefined} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><DateField label="Date" value={draft.date} onChange={(date) => set({ date })} /></View>
              <View style={{ flex: 1 }}><SelectField label="GST in bill" value={draft.gstRate} placeholder="No GST" options={GST_OPTIONS} onSelect={(gstRate) => set({ gstRate })} /></View>
            </View>
            <View style={{ gap: 7 }}>
              <TextBlock size={13} weight="semibold">Paid from</TextBlock>
              {accounts.length <= 3
                ? <Segmented options={accounts} value={draft.account} onChange={(account) => set({ account })} />
                : <SelectField label="" value={draft.account} placeholder="Cash or bank" options={accounts} onSelect={(account) => set({ account })} />}
            </View>
            <Field label="Description" value={draft.note} onChangeText={(note) => set({ note })} placeholder="e.g. Tempo bhada" />
            <Field label="Bill / voucher no." value={draft.reference} onChangeText={(reference) => set({ reference })} placeholder="Optional" autoCapitalize="characters" />
          </View>
        ) : null}
      </Sheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  top: { flexDirection: 'row' },
  bar: { height: 9, borderRadius: 9, overflow: 'hidden', flexDirection: 'row' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 6, borderRadius: 8 },
  dot: { width: 9, height: 9, borderRadius: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cat: { width: '23%', flexGrow: 1, alignItems: 'center', gap: 5, paddingVertical: 10, borderRadius: 12 },
});
