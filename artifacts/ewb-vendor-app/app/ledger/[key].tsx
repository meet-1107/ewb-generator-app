import React, { useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, EmptyState, IconButton, MoneyField, Page, Segmented, Sheet, TextBlock } from '@/components/AppUI';
import { DateField } from '@/components/DateField';
import { useDialog } from '@/components/Dialog';
import { draftFromEntry, EntrySheet, newDraft, type EntryDraft } from '@/components/EntrySheet';
import { BalanceHero } from '@/components/LedgerUI';
import { useColors } from '@/hooks/useColors';
import { formatDate, formatInr, today } from '@/lib/domain';
import { shareHtmlAsPdf } from '@/lib/documents';
import { CASH, drCr, partyKey, partyStatement, periodRange, scopedEntries } from '@/lib/ledger';
import { useAppStore, useScopedRecords } from '@/state/app-store';

const esc = (value: string) => value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
const num = (paise: number) => (paise ? formatInr(paise).replace('₹', '') : '');

/** One party's statement: every invoice, bill and payment with the running balance (Dr = to receive). */
export default function PartyStatementScreen() {
  const colors = useColors();
  const store = useAppStore();
  const dialog = useDialog();
  const { key = '' } = useLocalSearchParams<{ key: string }>();
  const { invoices, purchases } = useScopedRecords();
  const entries = useMemo(() => scopedEntries(store.entries, store.activeGstin), [store.entries, store.activeGstin]);
  const statement = useMemo(() => partyStatement([...invoices, ...purchases], entries, key), [invoices, purchases, entries, key]);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [opening, setOpening] = useState<{ id?: string; createdAt?: string; amountPaise: number; side: 'receive' | 'pay'; date: string } | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/ledger'));

  if (!statement) {
    return (
      <Page tab={false}>
        <View style={{ flexDirection: 'row' }}><IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={back} /></View>
        <Card><EmptyState icon="book-open" title="Party not found" body="This party has no invoices, bills or payments any more." /></Card>
      </Page>
    );
  }

  const balance = statement.balance;
  const business = store.business;
  const openingEntry = entries.find((entry) => entry.kind === 'opening' && !entry.account && entry.partyName && partyKey(entry.partyName, entry.partyGstin) === key);

  const recordPayment = () => setDraft(newDraft(CASH, balance < 0 ? 'payment' : 'receipt', { partyName: statement.name, partyGstin: statement.gstin, amountPaise: Math.abs(balance), mode: '' }));

  const openLine = (line: (typeof statement.rows)[number]) => {
    if (line.invoiceId) return router.push({ pathname: '/invoice/[id]', params: { id: line.invoiceId, view: '1' } });
    const entry = entries.find((item) => item.id === line.entryId);
    if (!entry) return;
    if (entry.kind === 'opening') return setOpening({ id: entry.id, createdAt: entry.createdAt, amountPaise: Math.abs(entry.amountPaise), side: entry.amountPaise < 0 ? 'pay' : 'receive', date: entry.date });
    setDraft(draftFromEntry(entry));
  };

  const saveOpening = async () => {
    if (!opening) return;
    await store.saveEntry({ id: opening.id, createdAt: opening.createdAt, kind: 'opening', account: '', amountPaise: opening.side === 'pay' ? -opening.amountPaise : opening.amountPaise, date: opening.date, partyName: statement.name, partyGstin: statement.gstin || undefined, gstin: store.activeGstin || undefined });
    setOpening(null);
    dialog.toast('Opening balance saved', 'success');
  };

  const html = () => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#17231c;margin:28px;font-size:12px}
    h1{font-size:18px;margin:0}.muted{color:#5f6a63}table{width:100%;border-collapse:collapse;margin-top:14px}
    th{background:#eef3ee;text-align:left;font-size:11px;padding:7px;border-bottom:1px solid #cfd4ca}td{padding:7px;border-bottom:1px solid #e3e4db;vertical-align:top}
    .n{text-align:right;white-space:nowrap}.box{border:1px solid #175b42;border-radius:8px;padding:10px 14px;margin-top:14px;display:flex;justify-content:space-between}
    .big{font-size:16px;font-weight:700;color:#175b42}
  </style></head><body>
    <h1>${esc(business?.name ?? '')}</h1><div class="muted">${esc([business?.address, business?.state].filter(Boolean).join(', '))}${store.activeGstin ? ` · GSTIN ${esc(store.activeGstin)}` : ''}</div>
    <h2 style="font-size:15px;margin:18px 0 2px">Statement of account · ${esc(statement.name)}</h2>
    <div class="muted">${statement.gstin ? `GSTIN ${esc(statement.gstin)} · ` : ''}As on ${esc(formatDate(today()))}</div>
    <table><tr><th>Date</th><th>Details</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr>
    ${statement.rows.map((row) => `<tr><td>${esc(formatDate(row.date))}</td><td>${esc(row.title)}${row.detail ? `<div class="muted">${esc(row.detail)}</div>` : ''}</td><td class="n">${num(row.debit)}</td><td class="n">${num(row.credit)}</td><td class="n">${num(Math.abs(row.balance)) || '0'} ${drCr(row.balance)}</td></tr>`).join('')}
    </table>
    <div class="box"><span>${balance > 0 ? 'Balance due to us' : balance < 0 ? 'Balance payable by us' : 'Account settled'}</span><span class="big">${formatInr(Math.abs(balance))} ${drCr(balance)}</span></div>
    <p class="muted" style="margin-top:18px">Computer-generated statement from E-Way Easy.</p>
  </body></html>`;

  const sharePdf = async () => {
    try {
      await shareHtmlAsPdf(html(), `Statement ${statement.name}`);
    } catch (error) {
      dialog.toast((error as Error).message || 'Could not make the PDF', 'danger');
    }
  };

  const remind = async () => {
    const message = balance > 0
      ? `Dear ${statement.name},\nYour balance with ${business?.name ?? 'us'} is ${formatInr(balance)} as on ${formatDate(today())}. Kindly arrange the payment at the earliest.\nThank you.`
      : `Dear ${statement.name},\nAs per our books, ${formatInr(Math.abs(balance))} is payable by ${business?.name ?? 'us'} as on ${formatDate(today())}.`;
    try { await Share.share({ message }); } catch { dialog.toast('Could not open the share options', 'danger'); }
  };

  return (
    <Page contentStyle={styles.page} tab={false} onRefresh={() => void store.syncNow()} refreshing={store.syncState === 'syncing'}>
      <View style={styles.top}>
        <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={back} />
        <View style={{ flex: 1 }} />
        <IconButton icon="share-2" accessibilityLabel="Share statement PDF" onPress={() => void sharePdf()} />
      </View>
      <View>
        <TextBlock size={11} weight="bold" color={colors.mutedForeground} style={{ letterSpacing: 1 }}>PARTY LEDGER</TextBlock>
        <TextBlock size={22} weight="bold">{statement.name}</TextBlock>
        {statement.gstin ? <TextBlock size={12} color={colors.mutedForeground}>{statement.gstin}</TextBlock> : null}
      </View>
      <BalanceHero
        label={balance > 0 ? 'Balance · to receive' : balance < 0 ? 'Balance · to pay' : 'Balance · settled'}
        amount={`${formatInr(Math.abs(balance))} ${drCr(balance)}`}
        detail={`${statement.rows.length} entr${statement.rows.length === 1 ? 'y' : 'ies'} · as on ${formatDate(today())}`}
        action={openingEntry ? undefined : 'Set opening'}
        onAction={() => setOpening({ amountPaise: 0, side: 'receive', date: periodRange('fy').from })}
      />

      <View style={[styles.table, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.tr, { backgroundColor: colors.muted }]}>
          <TextBlock size={10} weight="bold" color={colors.mutedForeground} style={styles.cDetail}>DATE · DETAILS</TextBlock>
          <TextBlock size={10} weight="bold" color={colors.mutedForeground} style={styles.cNum}>DEBIT</TextBlock>
          <TextBlock size={10} weight="bold" color={colors.mutedForeground} style={styles.cNum}>CREDIT</TextBlock>
          <TextBlock size={10} weight="bold" color={colors.mutedForeground} style={styles.cBal}>BALANCE</TextBlock>
        </View>
        {statement.rows.map((row, index) => (
          <Pressable key={`${row.invoiceId ?? row.entryId}-${index}`} onPress={() => openLine(row)} style={({ pressed }) => [styles.tr, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}>
            <View style={styles.cDetail}>
              <TextBlock size={12} weight="semibold" numberOfLines={1}>{row.title}</TextBlock>
              <TextBlock size={11} color={colors.mutedForeground} numberOfLines={1}>{[formatDate(row.date), row.detail].filter(Boolean).join(' · ')}</TextBlock>
            </View>
            <TextBlock size={12} style={styles.cNum}>{num(row.debit)}</TextBlock>
            <TextBlock size={12} color={colors.successForeground} style={styles.cNum}>{num(row.credit)}</TextBlock>
            <TextBlock size={12} weight="semibold" style={styles.cBal}>{num(Math.abs(row.balance)) || '0'} {drCr(row.balance)}</TextBlock>
          </Pressable>
        ))}
      </View>
      <TextBlock size={11} color={colors.mutedForeground}>Debit = amount to receive (sales). Credit = payments received or purchases from this party.</TextBlock>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={balance < 0 ? 'Record payment made' : 'Record payment'} icon={balance < 0 ? 'arrow-up-right' : 'arrow-down-left'} onPress={recordPayment} style={{ flex: 1.3 }} testID="ledger-record" />
        <Button title="Remind" icon="message-circle" variant="outline" onPress={() => void remind()} style={{ flex: 1 }} />
      </View>
      <Button title="Share statement PDF" icon="file-text" variant="outline" onPress={() => void sharePdf()} />

      <EntrySheet draft={draft} onClose={() => setDraft(null)} chooseAccount />

      <Sheet
        visible={Boolean(opening)}
        onClose={() => setOpening(null)}
        title="Opening balance"
        subtitle={`What was due with ${statement.name} before these entries`}
        footer={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {opening?.id ? <Button title="Delete" variant="danger" style={{ flex: 1 }} onPress={() => { if (opening?.id) void store.removeEntry(opening.id).then(() => setOpening(null)); }} /> : null}
            <Button title="Save" style={{ flex: 2 }} onPress={() => void saveOpening()} />
          </View>
        )}
      >
        {opening ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            <Segmented options={[{ label: 'To receive', value: 'receive' }, { label: 'To pay', value: 'pay' }]} value={opening.side} onChange={(side) => setOpening({ ...opening, side })} />
            <MoneyField label="Amount" paise={opening.amountPaise} onChange={(amountPaise) => setOpening({ ...opening, amountPaise })} />
            <DateField label="As on" value={opening.date} onChange={(date) => setOpening({ ...opening, date })} />
          </View>
        ) : null}
      </Sheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center' },
  table: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10, gap: 6 },
  cDetail: { flex: 1, minWidth: 0 },
  cNum: { width: 64, textAlign: 'right' },
  cBal: { width: 84, textAlign: 'right' },
});
