import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, EmptyState, Field, IconButton, ListRow, MoneyField, ScreenHeader, SearchBar, SelectField, Sheet, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { formatInr, GST_RATES, gstinProblem, STATES, stateForGstin, UNITS, VEHICLE_PATTERN, type Party, type Product, type Transporter } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

type Kind = 'parties' | 'products' | 'transporters';
const META: Record<Kind, { title: string; singular: string; icon: 'users' | 'package' | 'truck'; empty: string }> = {
  parties: { title: 'Buyers & receivers', singular: 'buyer', icon: 'users', empty: 'Buyers are saved automatically when you review an invoice, or add one here.' },
  products: { title: 'Products & services', singular: 'product', icon: 'package', empty: 'Save products with HSN, unit and GST rate to fill invoice lines in one tap.' },
  transporters: { title: 'Transporters', singular: 'transporter', icon: 'truck', empty: 'Save transporters and their usual vehicle to speed up e-way bills.' },
};
const stateOptions = STATES.map((state) => ({ value: state.name, label: state.name }));

type Draft = Record<string, string | number>;

export default function SavedDetailsScreen() {
  const { kind: rawKind } = useLocalSearchParams<{ kind: string }>();
  const kind: Kind = rawKind === 'products' || rawKind === 'transporters' ? rawKind : 'parties';
  const meta = META[kind];
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const items = (kind === 'parties' ? store.parties : kind === 'products' ? store.products : store.transporters) as (Party | Product | Transporter)[];
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return [...items].sort((a, b) => a.name.localeCompare(b.name)).filter((item) => !clean || JSON.stringify(item).toLowerCase().includes(clean));
  }, [items, query]);

  const blank = (): Draft => (kind === 'parties'
    ? { name: '', gstin: '', address: '', state: '', pincode: '', phone: '' }
    : kind === 'products' ? { name: '', hsn: '', unit: 'Nos', taxRate: 18, unitPricePaise: 0 } : { name: '', transporterId: '', vehicleNumber: '' });

  const save = async () => {
    if (!draft) return;
    const next: Record<string, string> = {};
    if (!String(draft.name).trim()) next.name = 'Name is required.';
    if (kind === 'parties') {
      const problem = String(draft.gstin) && String(draft.gstin).toUpperCase() !== 'URP' ? gstinProblem(String(draft.gstin)) : null;
      if (problem) next.gstin = problem;
      if (draft.pincode && !/^[1-9]\d{5}$/.test(String(draft.pincode))) next.pincode = 'PIN code must be 6 digits.';
    }
    if (kind === 'products' && !/^\d{4}(\d{2})?(\d{2})?$/.test(String(draft.hsn))) next.hsn = 'HSN/SAC must be 4, 6 or 8 digits.';
    if (kind === 'transporters') {
      if (draft.transporterId && gstinProblem(String(draft.transporterId))) next.transporterId = gstinProblem(String(draft.transporterId))!;
      if (draft.vehicleNumber && !VEHICLE_PATTERN.test(String(draft.vehicleNumber))) next.vehicleNumber = 'Format looks wrong (e.g. MH12AB1234).';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    const clean = { ...draft, name: String(draft.name).trim() };
    if (kind === 'parties') await store.saveParty(clean as unknown as Party);
    else if (kind === 'products') await store.saveProduct(clean as unknown as Product);
    else await store.saveTransporter(clean as unknown as Transporter);
    dialog.toast(`${meta.singular[0]!.toUpperCase()}${meta.singular.slice(1)} saved`, 'success');
    setDraft(null);
  };

  const remove = async () => {
    if (!draft?.id) return;
    const ok = await dialog.confirm({ title: `Delete ${draft.name}?`, message: 'Existing invoices keep their copy of these details.', confirmLabel: 'Delete', tone: 'danger', icon: 'trash-2' });
    if (!ok) return;
    const id = String(draft.id);
    if (kind === 'parties') await store.removeParty(id);
    else if (kind === 'products') await store.removeProduct(id);
    else await store.removeTransporter(id);
    setDraft(null);
    dialog.toast('Deleted');
  };

  const field = (key: string) => ({ value: String(draft?.[key] ?? ''), error: errors[key], onChangeText: (value: string) => { setDraft((current) => (current ? { ...current, [key]: value } : current)); setErrors((current) => ({ ...current, [key]: '' })); } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={meta.title} subtitle={`${items.length} saved · synced to your account`} right={<IconButton icon="plus" accessibilityLabel={`Add ${meta.singular}`} onPress={() => { setErrors({}); setDraft(blank()); }} />} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]} keyboardShouldPersistTaps="handled">
        {items.length > 5 ? <SearchBar value={query} onChangeText={setQuery} placeholder={`Search ${meta.title.toLowerCase()}`} /> : null}
        {filtered.length ? (
          <Card style={{ padding: 0, gap: 0 }}>
            {filtered.map((item, index) => (
              <React.Fragment key={item.id}>
                {index ? <Divider inset={64} /> : null}
                <ListRow
                  icon={meta.icon}
                  title={item.name}
                  detail={'gstin' in item ? `${item.gstin || 'Unregistered'} · ${item.state || 'State not set'}` : 'hsn' in item ? `HSN ${item.hsn} · ${item.taxRate}% · ${item.unitPricePaise ? `${formatInr(item.unitPricePaise)}/${item.unit}` : item.unit}` : [item.transporterId, item.vehicleNumber].filter(Boolean).join(' · ') || 'No ID saved'}
                  onPress={() => { setErrors({}); setDraft({ ...(item as unknown as Draft) }); }}
                />
              </React.Fragment>
            ))}
          </Card>
        ) : (
          <Card><EmptyState icon={meta.icon} title={query ? 'No matches' : `No ${meta.title.toLowerCase()} yet`} body={query ? 'Try another search.' : meta.empty} action={!query ? <Button title={`Add ${meta.singular}`} icon="plus" onPress={() => setDraft(blank())} /> : undefined} /></Card>
        )}
      </ScrollView>

      <Sheet visible={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? `Edit ${meta.singular}` : `New ${meta.singular}`}
        footer={<View style={{ flexDirection: 'row', gap: 10 }}>
          {draft?.id ? <Button title="Delete" variant="danger" onPress={() => void remove()} style={{ flex: 1 }} /> : null}
          <Button title="Save" onPress={() => void save()} style={{ flex: 2 }} />
        </View>}>
        {draft ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            <Field label="Name" required {...field('name')} autoCapitalize="words" />
            {kind === 'parties' ? <>
              <Field label="GSTIN" {...field('gstin')} onChangeText={(value) => {
                const gstin = value.toUpperCase().replace(/\s/g, '');
                setDraft((current) => current ? { ...current, gstin, ...(gstin.length === 15 && !gstinProblem(gstin) ? { state: stateForGstin(gstin)?.name ?? current.state } : {}) } : current);
              }} autoCapitalize="characters" maxLength={15} placeholder="Leave empty if unregistered" />
              <Field label="Address" {...field('address')} multiline />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1.3 }}><SelectField label="State" value={String(draft.state ?? '')} placeholder="Choose" options={stateOptions} onSelect={(value) => setDraft({ ...draft, state: value })} /></View>
                <View style={{ flex: 1 }}><Field label="PIN code" {...field('pincode')} keyboardType="number-pad" maxLength={6} /></View>
              </View>
              <Field label="Phone" {...field('phone')} keyboardType="phone-pad" />
            </> : null}
            {kind === 'products' ? <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Field label="HSN / SAC" required {...field('hsn')} keyboardType="number-pad" maxLength={8} /></View>
                <View style={{ flex: 1 }}><SelectField label="Unit" value={String(draft.unit)} placeholder="Nos" options={UNITS.map((unit) => ({ value: unit, label: unit }))} onSelect={(value) => setDraft({ ...draft, unit: value })} /></View>
              </View>
              <MoneyField label="Default rate per unit" paise={Number(draft.unitPricePaise) || 0} onChange={(value) => setDraft((current) => (current ? { ...current, unitPricePaise: value } : current))} hint="Optional — fills quantity × rate" />
              <SelectField label="GST rate" value={String(draft.taxRate)} placeholder="18%" options={GST_RATES.map((rate) => ({ value: String(rate), label: `${rate}%` }))} onSelect={(value) => setDraft({ ...draft, taxRate: Number(value) })} />
            </> : null}
            {kind === 'transporters' ? <>
              <Field label="Transporter ID / GSTIN" {...field('transporterId')} onChangeText={(value) => setDraft({ ...draft, transporterId: value.toUpperCase().replace(/\s/g, '') })} autoCapitalize="characters" maxLength={15} />
              <Field label="Usual vehicle number" {...field('vehicleNumber')} onChangeText={(value) => setDraft({ ...draft, vehicleNumber: value.toUpperCase().replace(/[\s-]/g, '') })} autoCapitalize="characters" maxLength={12} />
            </> : null}
            <TextBlock size={11} color={colors.mutedForeground}>Editing saved details never changes invoices or bills you already created.</TextBlock>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
});
