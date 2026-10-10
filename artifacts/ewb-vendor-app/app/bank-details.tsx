import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Checkbox, Divider, EmptyState, Field, IconButton, ListRow, ScreenHeader, Segmented, SelectSheet, Sheet, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { BANK_ACCOUNT_TYPES, bankAccountProblems, bankShareText, defaultBank, IFSC_PATTERN, uid, type BankAccount } from '@/lib/domain';
import { BANKS, bankForIfsc, lookupIfsc } from '@/lib/banks';
import { useAppStore } from '@/state/app-store';

type Draft = Omit<BankAccount, 'id' | 'updatedAt'> & { id?: string; isDefault: boolean };

const bankOptions = BANKS.map((bank) => ({ value: bank.name, label: bank.name }));

const blank = (isDefault: boolean): Draft => ({ accountName: '', bankName: '', accountNumber: '', ifsc: '', branch: '', accountType: 'Current', upiId: '', isDefault });

/** The business's bank accounts. The default one is filled into new invoices; each invoice can pick another. */
export default function BankDetailsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const business = store.business;
  const banks = business?.bankAccounts ?? [];
  const current = defaultBank(business);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bankPicker, setBankPicker] = useState(false);
  /** What the IFSC lookup found, shown under the IFSC field. */
  const [ifscNote, setIfscNote] = useState('');
  const lookedUp = useRef('');

  const open = (bank?: BankAccount) => {
    setErrors({});
    setIfscNote('');
    lookedUp.current = bank?.ifsc ?? '';
    setDraft(bank ? { ...bank, upiId: bank.upiId ?? '', isDefault: bank.id === current?.id } : { ...blank(!banks.length), accountName: business?.name ?? '' });
  };

  const field = (key: 'accountName' | 'bankName' | 'accountNumber' | 'ifsc' | 'branch' | 'upiId', clean: (value: string) => string = (value) => value) => ({
    value: draft?.[key] ?? '',
    error: errors[key],
    onChangeText: (value: string) => {
      setDraft((existing) => (existing ? { ...existing, [key]: clean(value) } : existing));
      setErrors((existing) => ({ ...existing, [key]: '' }));
    },
  });

  // A complete IFSC fills in the branch (and the bank, when not chosen yet).
  const draftIfsc = draft?.ifsc ?? '';
  useEffect(() => {
    if (!IFSC_PATTERN.test(draftIfsc) || lookedUp.current === draftIfsc) return;
    lookedUp.current = draftIfsc;
    const known = bankForIfsc(draftIfsc);
    setIfscNote('Finding the branch…');
    let live = true;
    lookupIfsc(draftIfsc).then((details) => {
      if (!live) return;
      if (!details) {
        setIfscNote('');
        setErrors((current) => ({ ...current, ifsc: 'This IFSC was not found. Please check it.' }));
        return;
      }
      setDraft((current) => current && current.ifsc === draftIfsc ? {
        ...current,
        branch: details.branch || current.branch,
        bankName: current.bankName.trim() || known?.name || details.bank,
      } : current);
      setErrors((current) => ({ ...current, branch: '', bankName: '' }));
      setIfscNote(`${details.bank}${details.branch ? ` · ${details.branch}` : ''}${details.city ? `, ${details.city}` : ''}`);
    }).catch(() => {
      if (!live) return;
      if (known) setDraft((current) => current && current.ifsc === draftIfsc && !current.bankName.trim() ? { ...current, bankName: known.name } : current);
      setIfscNote('Could not get the branch right now. Please type it.');
    });
    return () => { live = false; };
  }, [draftIfsc]);

  const save = async () => {
    if (!draft || !business) return;
    const problems = bankAccountProblems(draft);
    setErrors(problems as Record<string, string>);
    if (Object.keys(problems).length) return;
    const { isDefault, ...fields } = draft;
    const saved: BankAccount = {
      ...fields,
      id: draft.id ?? uid('bank'),
      accountName: fields.accountName.trim(),
      bankName: fields.bankName.trim(),
      branch: fields.branch.trim(),
      upiId: fields.upiId?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    const next = draft.id ? banks.map((bank) => (bank.id === draft.id ? saved : bank)) : [...banks, saved];
    const defaultBankId = isDefault || !next.some((bank) => bank.id === business.defaultBankId) ? saved.id : business.defaultBankId;
    await store.saveBusiness({ ...business, bankAccounts: next, defaultBankId });
    setDraft(null);
    dialog.toast(draft.id ? 'Bank account updated' : 'Bank account added', 'success');
  };

  const share = async (bank: BankAccount) => {
    try {
      await Share.share({ title: `${bank.bankName} bank details`, message: bankShareText(bank) });
    } catch {
      dialog.toast('Could not open the share options', 'danger');
    }
  };

  const remove = async () => {
    if (!draft?.id || !business) return;
    const ok = await dialog.confirm({ title: `Delete ${draft.bankName}?`, message: 'Invoices already saved keep the bank details printed on them.', confirmLabel: 'Delete', tone: 'danger', icon: 'trash-2' });
    if (!ok) return;
    const next = banks.filter((bank) => bank.id !== draft.id);
    await store.saveBusiness({ ...business, bankAccounts: next, defaultBankId: business.defaultBankId === draft.id ? next[0]?.id : business.defaultBankId });
    setDraft(null);
    dialog.toast('Bank account deleted');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Bank details"
        subtitle={banks.length ? `${banks.length} saved · printed on invoices` : 'Printed on your invoices'}
        right={banks.length ? <IconButton icon="plus" accessibilityLabel="Add bank account" onPress={() => open()} /> : undefined}
      />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
        {banks.length ? (
          <>
            <Card style={{ padding: 0, gap: 0 }}>
              {banks.map((bank, index) => (
                <React.Fragment key={bank.id}>
                  {index ? <Divider inset={64} /> : null}
                  <ListRow
                    icon="credit-card"
                    title={bank.bankName}
                    detail={`A/c ${bank.accountNumber} · ${bank.ifsc}`}
                    right={(
                      <View style={styles.rowRight}>
                        {bank.id === current?.id ? <StatusPill label="Default" tone="green" /> : null}
                        <IconButton icon="share-2" accessibilityLabel={`Share ${bank.bankName} details`} onPress={() => void share(bank)} />
                      </View>
                    )}
                    onPress={() => open(bank)}
                    testID={`bank-${index}`}
                  />
                </React.Fragment>
              ))}
            </Card>
            <TextBlock size={12} color={colors.mutedForeground}>The default bank is added to new invoices. You can choose another bank, or none, on each invoice.</TextBlock>
            <Button title="Add another bank account" icon="plus" variant="outline" onPress={() => open()} testID="bank-add-another" />
          </>
        ) : (
          <Card>
            <EmptyState
              icon="credit-card"
              title="No bank account yet"
              body="Add the account your buyers pay into. It is printed on your invoices."
              action={<Button title="Add bank account" icon="plus" onPress={() => open()} testID="bank-add" />}
            />
          </Card>
        )}
      </ScrollView>

      <Sheet
        visible={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit bank account' : 'Add bank account'}
        footer={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {draft?.id ? <Button title="Delete" variant="danger" onPress={() => void remove()} style={{ flex: 1 }} /> : null}
            {draft?.id ? <Button title="Share" icon="share-2" variant="outline" onPress={() => { const saved = banks.find((bank) => bank.id === draft.id); if (saved) void share(saved); }} style={{ flex: 1 }} /> : null}
            <Button title="Save" onPress={() => void save()} style={{ flex: 2 }} testID="bank-save" />
          </View>
        )}
      >
        {draft ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            <Field label="Account holder name" required {...field('accountName')} autoCapitalize="words" testID="bank-account-name" />
            <Field
              label="Bank name"
              required
              {...field('bankName')}
              placeholder="Choose from the list or type"
              autoCapitalize="words"
              right={<Button title="List" icon="list" size="sm" variant="outline" onPress={() => setBankPicker(true)} testID="bank-name-list" />}
              testID="bank-name"
            />
            <Field label="Account number" required {...field('accountNumber', (value) => value.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={18} testID="bank-account-number" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Field label="IFSC" required {...field('ifsc', (value) => { setIfscNote(''); return value.toUpperCase().replace(/\s/g, ''); })} placeholder="SBIN0001234" autoCapitalize="characters" maxLength={11} testID="bank-ifsc" /></View>
              <View style={{ flex: 1 }}><Field label="Branch" {...field('branch')} placeholder="Fills from IFSC" autoCapitalize="words" testID="bank-branch" /></View>
            </View>
            {ifscNote && !errors.ifsc ? <TextBlock size={12} color={colors.mutedForeground}>{ifscNote}</TextBlock> : null}
            <View style={{ gap: 7 }}>
              <TextBlock size={13} weight="semibold">Account type</TextBlock>
              <Segmented options={BANK_ACCOUNT_TYPES.map((type) => ({ label: type, value: type }))} value={draft.accountType} onChange={(accountType) => setDraft({ ...draft, accountType })} />
            </View>
            <Field label="UPI ID" {...field('upiId', (value) => value.trim())} placeholder="Optional, e.g. business@okhdfc" autoCapitalize="none" />
            <Checkbox checked={draft.isDefault} onToggle={() => setDraft({ ...draft, isDefault: !draft.isDefault })} label="Use on new invoices (default)" testID="bank-default" />
          </View>
        ) : null}
      </Sheet>

      <SelectSheet
        visible={bankPicker}
        onClose={() => setBankPicker(false)}
        title="Choose bank"
        options={bankOptions}
        value={draft?.bankName}
        onSelect={(bankName) => {
          setDraft((current) => (current ? { ...current, bankName } : current));
          setErrors((current) => ({ ...current, bankName: '' }));
          setBankPicker(false);
        }}
        footer={<Button title="Bank not in the list? Type it" variant="outline" onPress={() => setBankPicker(false)} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
});
