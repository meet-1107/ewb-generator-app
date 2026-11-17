import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, MoneyField, Segmented, SelectField, SelectSheet, Sheet, TextBlock } from '@/components/AppUI';
import { DateField } from '@/components/DateField';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { formatInr, formatDate, isPurchase, today } from '@/lib/domain';
import { accountLabel, amountDue, BANK_MODES, CASH, partyKey, partySummaries, scopedEntries, type Entry } from '@/lib/ledger';
import { useAppStore, useScopedRecords } from '@/state/app-store';

type MoneyKind = 'receipt' | 'payment' | 'transfer';

export type EntryDraft = {
  id?: string;
  createdAt?: string;
  kind: MoneyKind;
  account: string;
  toAccount: string;
  amountPaise: number;
  date: string;
  partyName: string;
  partyGstin: string;
  invoiceId: string;
  mode: string;
  reference: string;
  note: string;
};

export const newDraft = (account: string, kind: MoneyKind, preset: Partial<EntryDraft> = {}): EntryDraft => ({
  kind,
  account,
  toAccount: '',
  amountPaise: 0,
  date: today(),
  partyName: '',
  partyGstin: '',
  invoiceId: '',
  mode: account === CASH ? '' : 'NEFT',
  reference: '',
  note: '',
  ...preset,
});

export const draftFromEntry = (entry: Entry): EntryDraft => ({
  id: entry.id,
  createdAt: entry.createdAt,
  kind: entry.kind === 'payment' || entry.kind === 'transfer' ? entry.kind : 'receipt',
  account: entry.account,
  toAccount: entry.toAccount ?? '',
  amountPaise: entry.amountPaise,
  date: entry.date,
  partyName: entry.partyName ?? '',
  partyGstin: entry.partyGstin ?? '',
  invoiceId: entry.invoiceId ?? '',
  mode: entry.mode ?? '',
  reference: entry.reference ?? '',
  note: entry.note ?? '',
});

/**
 * Add or edit a money entry: received, paid, or a transfer between cash and bank.
 * `chooseAccount` shows the cash/bank picker (from the party ledger); otherwise the
 * entry belongs to the book it was opened from.
 */
export function EntrySheet({ draft, onClose, chooseAccount = false }: { draft: EntryDraft | null; onClose: () => void; chooseAccount?: boolean }) {
  const colors = useColors();
  const store = useAppStore();
  const dialog = useDialog();
  const { invoices, purchases } = useScopedRecords();
  const banks = store.business?.bankAccounts ?? [];
  const [form, setForm] = useState<EntryDraft | null>(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [partyPicker, setPartyPicker] = useState(false);
  useEffect(() => { setForm(draft); setErrors({}); }, [draft]);

  const entries = useMemo(() => scopedEntries(store.entries, store.activeGstin), [store.entries, store.activeGstin]);
  const accounts = useMemo(() => [{ value: CASH, label: 'Cash' }, ...banks.map((bank) => ({ value: bank.id, label: accountLabel(bank.id, banks) }))], [banks]);

  // Parties: saved ones plus everyone on an invoice, bill or earlier entry.
  const partyOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string; detail?: string; gstin: string }>();
    for (const party of store.parties) seen.set(partyKey(party.name, party.gstin), { value: partyKey(party.name, party.gstin), label: party.name, detail: party.gstin || undefined, gstin: party.gstin });
    for (const summary of partySummaries([...invoices, ...purchases], entries)) {
      if (!seen.has(summary.key)) seen.set(summary.key, { value: summary.key, label: summary.name, detail: summary.gstin || undefined, gstin: summary.gstin });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [store.parties, invoices, purchases, entries]);

  if (!form) return <Sheet visible={false} onClose={onClose} title=""><View /></Sheet>;

  const isCash = form.account === CASH;
  const set = (patch: Partial<EntryDraft>) => {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setErrors((current) => { const next = { ...current }; for (const key of Object.keys(patch)) delete next[key]; return next; });
  };

  // Invoices (for money received) or purchase bills (for money paid) of this party still due.
  const key = form.partyName.trim() ? partyKey(form.partyName, form.partyGstin) : '';
  const documents = form.kind === 'transfer' || !key ? [] : (form.kind === 'receipt' ? invoices : purchases)
    .filter((invoice) => invoice.status !== 'draft' && partyKey(isPurchase(invoice) ? invoice.sellerName : invoice.buyerName, isPurchase(invoice) ? invoice.sellerGstin : invoice.buyerGstin) === key)
    .map((invoice) => ({ invoice, due: amountDue(invoice, entries.filter((entry) => entry.id !== form.id)) }))
    .filter((item) => item.due > 0 || item.invoice.id === form.invoiceId);
  const docOptions = [{ value: '', label: 'Not against an invoice' }, ...documents.map(({ invoice, due }) => ({ value: invoice.id, label: `${invoice.invoiceNumber || 'No number'} · ${formatInr(due)} due`, detail: formatDate(invoice.invoiceDate) }))];

  const kinds: { label: string; value: MoneyKind }[] = isCash
    ? [{ label: 'Cash in', value: 'receipt' }, { label: 'Cash out', value: 'payment' }, { label: banks.length ? 'To bank' : 'Transfer', value: 'transfer' }]
    : [{ label: 'Received', value: 'receipt' }, { label: 'Paid', value: 'payment' }, { label: 'Transfer', value: 'transfer' }];

  const save = async () => {
    const problems: Record<string, string> = {};
    if (form.amountPaise <= 0) problems.amountPaise = 'Enter the amount';
    if (!form.date) problems.date = 'Choose the date';
    if (form.kind === 'transfer' && (!form.toAccount || form.toAccount === form.account)) problems.toAccount = 'Choose where the money went';
    setErrors(problems);
    if (Object.keys(problems).length) return;
    const linked = [...invoices, ...purchases].find((invoice) => invoice.id === form.invoiceId);
    const transfer = form.kind === 'transfer';
    await store.saveEntry({
      id: form.id,
      createdAt: form.createdAt,
      kind: form.kind,
      account: form.account,
      ...(transfer ? { toAccount: form.toAccount } : {}),
      amountPaise: form.amountPaise,
      date: form.date,
      ...(!transfer && form.partyName.trim() ? { partyName: form.partyName.trim(), partyGstin: form.partyGstin.trim().toUpperCase() || undefined } : {}),
      ...(!transfer && linked ? { invoiceId: linked.id, invoiceNumber: linked.invoiceNumber } : {}),
      ...(!transfer && !isCash && form.mode ? { mode: form.mode } : {}),
      ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
      gstin: store.activeGstin || undefined,
    });
    dialog.toast(form.id ? 'Entry updated' : 'Entry saved', 'success');
    onClose();
  };

  const remove = async () => {
    if (!form.id) return;
    const ok = await dialog.confirm({ title: 'Delete this entry?', message: `${formatInr(form.amountPaise)} on ${formatDate(form.date)} will be removed from the books and the party ledger.`, confirmLabel: 'Delete', tone: 'danger', icon: 'trash-2' });
    if (!ok) return;
    await store.removeEntry(form.id);
    dialog.toast('Entry deleted');
    onClose();
  };

  const title = form.id ? 'Edit entry' : form.kind === 'transfer' ? 'Transfer' : isCash ? (form.kind === 'receipt' ? 'Cash in' : 'Cash out') : form.kind === 'receipt' ? 'Money in' : 'Money out';

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`${title}${chooseAccount ? '' : ` · ${accountLabel(form.account, banks)}`}`}
      subtitle={form.kind === 'transfer' ? 'Money moved between your cash and bank' : form.kind === 'receipt' ? 'Money that came in' : 'Money that went out'}
      tall
      footer={(
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {form.id ? <Button title="Delete" variant="danger" onPress={() => void remove()} style={{ flex: 1 }} /> : null}
          <Button title="Save entry" onPress={() => void save()} style={{ flex: 2 }} testID="entry-save" />
        </View>
      )}
    >
      <View style={{ paddingHorizontal: 18, gap: 12 }}>
        <Segmented options={kinds} value={form.kind} onChange={(kind) => set({ kind, toAccount: kind === 'transfer' ? accounts.find((item) => item.value !== form.account)?.value ?? '' : '' })} />
        {chooseAccount ? <SelectField label={form.kind === 'receipt' ? 'Received in' : 'Paid from'} value={form.account} placeholder="Cash or bank" options={accounts} onSelect={(account) => set({ account, mode: account === CASH ? '' : form.mode || 'NEFT' })} /> : null}
        <MoneyField label="Amount" required paise={form.amountPaise} onChange={(amountPaise) => set({ amountPaise })} error={errors.amountPaise} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><DateField label="Date" value={form.date} onChange={(date) => set({ date })} error={errors.date} /></View>
          {!isCash && form.kind !== 'transfer' ? <View style={{ flex: 1 }}><SelectField label="Mode" value={form.mode} placeholder="Choose" options={BANK_MODES.map((mode) => ({ value: mode, label: mode }))} onSelect={(mode) => set({ mode })} /></View> : null}
        </View>
        {form.kind === 'transfer' ? (
          accounts.length > 1
            ? <SelectField label={isCash ? 'Deposited in' : 'Moved to'} required value={form.toAccount} placeholder="Choose" options={accounts.filter((item) => item.value !== form.account)} onSelect={(toAccount) => set({ toAccount })} error={errors.toAccount} />
            : <TextBlock size={12} color={colors.dangerForeground}>Add a bank account in Account → Bank details to move money between cash and bank.</TextBlock>
        ) : (
          <>
            <Field
              label="Party"
              value={form.partyName}
              onChangeText={(partyName) => set({ partyName, partyGstin: '', invoiceId: '' })}
              placeholder="Optional · who paid or was paid"
              autoCapitalize="words"
              right={<Button title="List" icon="users" size="sm" variant="outline" onPress={() => setPartyPicker(true)} />}
            />
            {documents.length ? <SelectField label={form.kind === 'receipt' ? 'Against invoice' : 'Against purchase bill'} value={form.invoiceId} placeholder="Optional" options={docOptions} onSelect={(invoiceId) => {
              const due = documents.find((item) => item.invoice.id === invoiceId)?.due;
              set({ invoiceId, ...(due && !form.amountPaise ? { amountPaise: due } : {}) });
            }} /> : null}
          </>
        )}
        <Field label={isCash ? 'Receipt / voucher no.' : 'UTR / Cheque no.'} value={form.reference} onChangeText={(reference) => set({ reference })} placeholder="Optional" autoCapitalize="characters" />
        <Field label="Note" value={form.note} onChangeText={(note) => set({ note })} placeholder="Optional" />
      </View>
      <SelectSheet
        visible={partyPicker}
        onClose={() => setPartyPicker(false)}
        title="Choose party"
        options={partyOptions}
        value={key}
        emptyText="No parties yet. Type the name instead."
        onSelect={(value) => {
          const party = partyOptions.find((item) => item.value === value);
          if (party) set({ partyName: party.label, partyGstin: party.gstin, invoiceId: '' });
          setPartyPicker(false);
        }}
      />
    </Sheet>
  );
}
