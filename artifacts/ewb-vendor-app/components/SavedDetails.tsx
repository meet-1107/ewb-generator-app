import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, EmptyState, Field, IconButton, ListRow, MoneyField, ScreenHeader, SearchBar, SelectField, Sheet, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { useGstinVerify } from '@/hooks/useGstinVerify';
import { businessNameOf, formatInr, GST_RATES, gstinProblem, STATES, stateForGstin, transporterIdProblem, UNITS, VEHICLE_PATTERN, type Party, type Product, type Transporter } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';
import { AccountButton } from '@/components/Brand';

export type SavedKind = 'parties' | 'products' | 'transporters';
type Kind = SavedKind;
const META: Record<Kind, { title: string; singular: string; icon: 'users' | 'package' | 'truck'; empty: string }> = {
  parties: { title: 'Buyers', singular: 'buyer', icon: 'users', empty: 'Buyers are saved automatically when you review an invoice, or add one here.' },
  products: { title: 'Products', singular: 'product', icon: 'package', empty: 'Save products with HSN, unit and GST rate to fill invoice lines in one tap.' },
  transporters: { title: 'Transporters', singular: 'transporter', icon: 'truck', empty: 'Save transporters and their usual vehicle to speed up e-way bills.' },
};
const stateOptions = STATES.map((state) => ({ value: state.name, label: state.name }));

type Draft = Record<string, unknown>;

/** Saved buyers, products or transporters. `tab`: shown as a bottom tab (no back button, room for the tab bar). */
export default function SavedDetails({ kind, tab = false }: { kind: Kind; tab?: boolean }) {
  const meta = META[kind];
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { verify, verifying } = useGstinVerify();
  const canVerify = store.config?.gstinVerification !== false;

  const verifyParty = async () => {
    if (!draft) return;
    const details = await verify(String(draft.gstin ?? ''));
    if (!details) return;
    setDraft((current) => current ? {
      ...current,
      name: businessNameOf(details) || current.name,
      address: details.address || current.address,
      pincode: details.pincode || current.pincode,
      state: details.state || current.state,
      verified: { legalName: details.legalName, tradeName: details.tradeName, status: details.status, verifiedAt: details.verifiedAt, city: details.city },
    } : current);
    setErrors({});
  };

  // A full, valid GSTIN fills the buyer's details straight away (once per GSTIN).
  const autoVerified = useRef('');
  const draftGstin = kind === 'parties' && draft ? String(draft.gstin ?? '') : '';
  useEffect(() => {
    if (!canVerify || draftGstin.length !== 15 || gstinProblem(draftGstin) || autoVerified.current === draftGstin || draft?.verified) return;
    autoVerified.current = draftGstin;
    void verifyParty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftGstin, canVerify]);

  const items = (kind === 'parties' ? store.parties : kind === 'products' ? store.products : store.transporters) as (Party | Product | Transporter)[];
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return [...items].sort((a, b) => a.name.localeCompare(b.name)).filter((item) => !clean || JSON.stringify(item).toLowerCase().includes(clean));
  }, [items, query]);

  const blank = (): Draft => (kind === 'parties'
    ? { name: '', gstin: '', address: '', state: '', pincode: '', phone: '' }
    : kind === 'products' ? { name: '', hsn: '', unit: 'Nos', taxRate: 18, unitPricePaise: 0 } : { name: '', transporterId: '', phone: '', vehicleNumber: '' });

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
      const idProblem = transporterIdProblem(String(draft.transporterId ?? ''));
      if (idProblem) next.transporterId = idProblem;
      if (draft.phone && !/^[6-9]\d{9}$/.test(String(draft.phone).replace(/\D/g, '').slice(-10))) next.phone = 'Enter a 10-digit mobile number.';
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
      <ScreenHeader back={!tab} title={meta.title} subtitle={`${items.length} saved · synced to your account`} right={tab ? <AccountButton /> : undefined} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + (tab ? 180 : 100) }]} keyboardShouldPersistTaps="handled">
        {items.length > 5 ? <SearchBar value={query} onChangeText={setQuery} placeholder={`Search ${meta.title.toLowerCase()}`} /> : null}
        {filtered.length ? (
          <Card style={{ padding: 0, gap: 0 }}>
            {filtered.map((item, index) => (
              <React.Fragment key={item.id}>
                {index ? <Divider inset={64} /> : null}
                <ListRow
                  icon={meta.icon}
                  title={item.name}
                  detail={'gstin' in item ? `${item.gstin || 'Unregistered'} · ${item.state || 'State not set'}` : 'hsn' in item ? `HSN ${item.hsn} · ${item.taxRate}% · ${item.unitPricePaise ? `${formatInr(item.unitPricePaise)}/${item.unit}` : item.unit}` : [item.transporterId, (item as Transporter).phone, item.vehicleNumber].filter(Boolean).join(' · ') || 'No ID saved'}
                  onPress={() => { setErrors({}); setDraft({ ...(item as unknown as Draft) }); }}
                />
              </React.Fragment>
            ))}
          </Card>
        ) : (
          <Card><EmptyState icon={meta.icon} title={query ? 'No matches' : `No ${meta.title.toLowerCase()} yet`} body={query ? 'Try another search.' : meta.empty} action={!query ? <Button title={`Add ${meta.singular}`} icon="plus" onPress={() => setDraft(blank())} /> : undefined} /></Card>
        )}
      </ScrollView>

      <Pressable
        onPress={() => { autoVerified.current = ''; setErrors({}); setDraft(blank()); }}
        accessibilityRole="button"
        accessibilityLabel={`Add ${meta.singular}`}
        testID={`add-${meta.singular}`}
        style={({ pressed }) => [styles.fab, { bottom: insets.bottom + (tab ? 84 : 24), backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
      >
        <Feather name="plus" size={20} color={colors.primaryForeground} />
        <TextBlock size={15} weight="bold" color={colors.primaryForeground}>Add {meta.singular}</TextBlock>
      </Pressable>

      <Sheet visible={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? `Edit ${meta.singular}` : `New ${meta.singular}`}
        footer={<View style={{ flexDirection: 'row', gap: 10 }}>
          {draft?.id ? <Button title="Delete" variant="danger" onPress={() => void remove()} style={{ flex: 1 }} /> : null}
          <Button title="Save" onPress={() => void save()} style={{ flex: 2 }} />
        </View>}>
        {draft ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            {kind !== 'parties' ? <Field label={kind === 'transporters' ? 'Transporter name' : 'Product name'} required {...field('name')} autoCapitalize="words" testID="saved-name" /> : null}
            {kind === 'parties' ? <>
              <Field label="GSTIN" {...field('gstin')} onChangeText={(value) => {
                const gstin = value.toUpperCase().replace(/\s/g, '');
                setDraft((current) => current ? { ...current, gstin, ...(gstin !== current.gstin ? { verified: undefined } : {}), ...(gstin.length === 15 && !gstinProblem(gstin) ? { state: stateForGstin(gstin)?.name ?? current.state } : {}) } : current);
              }} autoCapitalize="characters" maxLength={15} placeholder="Enter GSTIN to fill the details"
                hint={canVerify ? (verifying ? 'Getting details from the GST network…' : 'Name, address, state and PIN fill in automatically. Leave empty if unregistered.') : 'Leave empty if unregistered.'}
                right={canVerify && String(draft.gstin ?? '').length === 15 && !draft.verified ? <Button title="Verify" size="sm" variant="outline" onPress={() => void verifyParty()} loading={verifying} testID="party-verify" /> : undefined} testID="party-gstin" />
              {draft.verified ? (
                <StatusPill label={`Verified · ${(draft.verified as { status: string }).status}`} tone={(draft.verified as { status: string }).status.toLowerCase() === 'active' ? 'green' : 'red'} icon="check" />
              ) : null}
              <Field label="Business name" required {...field('name')} autoCapitalize="words" testID="saved-name" />
              {draft.verified && (draft.verified as { legalName: string }).legalName && (draft.verified as { legalName: string }).legalName !== draft.name
                ? <TextBlock size={11} color={colors.mutedForeground}>Owner / legal name: {(draft.verified as { legalName: string }).legalName}</TextBlock> : null}
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
              <Field label="Transporter ID / GSTIN" required {...field('transporterId')} onChangeText={(value) => { setDraft({ ...draft, transporterId: value.toUpperCase().replace(/\s/g, '') }); setErrors((current) => ({ ...current, transporterId: '' })); }} autoCapitalize="characters" maxLength={15} placeholder="15-character ID" testID="saved-transporter-id" />
              <Field label="Phone number" {...field('phone')} keyboardType="phone-pad" maxLength={14} placeholder="Optional" />
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
  fab: { position: 'absolute', right: 18, height: 52, borderRadius: 26, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
});
