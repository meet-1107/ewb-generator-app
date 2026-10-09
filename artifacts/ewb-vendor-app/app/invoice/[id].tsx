import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  Field,
  IconButton,
  KeyValue,
  MoneyField,
  Notice,
  ProgressSteps,
  ScreenHeader,
  Segmented,
  SelectField,
  SelectSheet,
  StatusPill,
  TextBlock,
} from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import {
  expectedSupplyType,
  formatDate,
  formatInr,
  GST_RATES,
  invoiceIssues,
  invoiceTotals,
  lineTax,
  newInvoice,
  newLine,
  STATES,
  stateForGstin,
  gstinProblem,
  templates,
  today,
  transportIssues,
  TRANSPORT_MODES,
  uid,
  UNITS,
  type Invoice,
  type InvoiceLine,
  type Section,
} from '@/lib/domain';
import { invoiceHtml, printHtml, shareHtmlAsPdf } from '@/lib/documents';
import { useAppStore } from '@/state/app-store';

const stateOptions = STATES.map((state) => ({ value: state.name, label: state.name, detail: `Code ${state.code}` }));
const unitOptions = UNITS.map((unit) => ({ value: unit, label: unit }));
const sectionOrder = (templateId: string): Section[] =>
  templateId === 'dispatch' ? ['transport', 'seller', 'buyer', 'invoice', 'items'] : ['seller', 'buyer', 'invoice', 'items', 'transport'];

export default function InvoiceEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [open, setOpen] = useState<Record<Section, boolean>>({ seller: false, buyer: true, invoice: true, items: true, transport: false });
  const [attempted, setAttempted] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'idle'>('saved');
  const [picker, setPicker] = useState<null | 'buyer' | 'transporter' | { line: string }>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || !store.isHydrated) return;
    const found = store.invoices.find((item) => item.id === id);
    loaded.current = true;
    if (found) {
      setInvoice(found);
      if (found.templateId === 'dispatch') setOpen((current) => ({ ...current, transport: true }));
      if (!found.sellerGstin || !found.sellerName) setOpen((current) => ({ ...current, seller: true }));
    } else {
      void dialog.alert({ title: 'Invoice not found', message: 'It may have been deleted on another device.', tone: 'warning' }).then(() => router.back());
    }
  }, [dialog, id, store.invoices, store.isHydrated]);

  // If a bill was generated (here or on another device), lock this editor to the stored copy.
  const stored = store.invoices.find((item) => item.id === id);
  useEffect(() => {
    if (stored && invoice && stored.status === 'ewb_generated' && invoice.status !== 'ewb_generated') setInvoice(stored);
  }, [stored, invoice]);

  // Debounced autosave; the explicit "Save draft" button saves immediately.
  useEffect(() => {
    if (!invoice || invoice.status === 'ewb_generated') return;
    setSaveState('saving');
    const timer = setTimeout(() => {
      void store.saveInvoice(invoice).then(() => setSaveState('saved'));
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  const locked = invoice?.status === 'ewb_generated';
  const issues = useMemo(() => (invoice ? [...invoiceIssues(invoice, store.invoices), ...transportIssues(invoice)] : []), [invoice, store.invoices]);
  const errorFor = (field: string) => (attempted ? issues.find((issue) => issue.field === field)?.message : undefined);
  const sectionErrors = (section: Section) => (attempted ? issues.filter((issue) => issue.section === section).length : 0);
  const totals = invoice ? invoiceTotals(invoice) : null;

  const patch = (changes: Partial<Invoice>) => {
    setInvoice((current) => {
      if (!current) return current;
      const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
      if ('sellerState' in changes || 'buyerState' in changes) {
        const expected = expectedSupplyType(next);
        if (expected) next.supplyType = expected;
        if ('buyerState' in changes && (!current.placeOfSupply || current.placeOfSupply === current.buyerState)) next.placeOfSupply = next.buyerState;
      }
      // Any edit to a ready invoice sends it back to draft until reviewed again.
      if (current.status === 'ready' && !('status' in changes)) next.status = 'draft';
      return next;
    });
  };
  const set = <K extends keyof Invoice>(key: K) => (value: Invoice[K]) => patch({ [key]: value } as Partial<Invoice>);
  const patchLine = (lineId: string, changes: Partial<InvoiceLine>) => {
    setInvoice((current) => {
      if (!current) return current;
      const lines = current.lines.map((line) => {
        if (line.id !== lineId) return line;
        const next = { ...line, ...changes };
        if (next.unitPricePaise && ('quantity' in changes || 'unitPricePaise' in changes)) {
          next.taxablePaise = Math.round((Number(next.quantity) || 0) * next.unitPricePaise);
        }
        return next;
      });
      return { ...current, lines, status: current.status === 'ready' ? 'draft' : current.status, updatedAt: new Date().toISOString() };
    });
  };

  const onGstinChange = (key: 'sellerGstin' | 'buyerGstin', stateKey: 'sellerState' | 'buyerState') => (raw: string) => {
    const value = raw.toUpperCase().replace(/\s/g, '');
    const changes: Partial<Invoice> = { [key]: value };
    if (value.length === 15 && !gstinProblem(value)) changes[stateKey] = stateForGstin(value)?.name ?? '';
    patch(changes);
  };

  const saveDraft = async () => {
    Keyboard.dismiss();
    if (!invoice) return;
    await store.saveInvoice({ ...invoice, updatedAt: new Date().toISOString() });
    setSaveState('saved');
    dialog.toast('Draft saved', 'success');
  };

  const continueToReview = async () => {
    Keyboard.dismiss();
    if (!invoice) return;
    setAttempted(true);
    if (issues.length) {
      setOpen((current) => {
        const next = { ...current };
        for (const issue of issues) next[issue.section] = true;
        return next;
      });
      dialog.toast(`Fix ${issues.length} item${issues.length === 1 ? '' : 's'} highlighted in red`, 'danger');
      return;
    }
    const ready: Invoice = { ...invoice, status: 'ready', updatedAt: new Date().toISOString(), extraction: invoice.extraction ? { ...invoice.extraction, confirmed: true } : undefined };
    setInvoice(ready);
    await store.saveInvoice(ready);
    // Remember new buyers and transporters for next time.
    const knownBuyer = store.parties.some((party) => (ready.buyerGstin && party.gstin === ready.buyerGstin) || party.name.toLowerCase() === ready.buyerName.trim().toLowerCase());
    if (!knownBuyer) await store.saveParty({ name: ready.buyerName.trim(), gstin: ready.buyerGstin, address: ready.buyerAddress, state: ready.buyerState, pincode: ready.buyerPincode, phone: '' });
    if (ready.transporterName.trim() && !store.transporters.some((item) => item.name.toLowerCase() === ready.transporterName.trim().toLowerCase())) {
      await store.saveTransporter({ name: ready.transporterName.trim(), transporterId: ready.transporterId, vehicleNumber: ready.vehicleNumber });
    }
    router.push({ pathname: '/ewb/review/[invoiceId]', params: { invoiceId: ready.id } });
  };

  const moreActions = async () => {
    if (!invoice) return;
    const choices = ['Print invoice', 'Share as PDF', 'Duplicate as new draft', ...(invoice.status !== 'ewb_generated' ? ['Delete draft'] : [])];
    const result = await dialog.prompt({ title: 'Invoice actions', choices, confirmLabel: 'Continue' });
    if (!result) return;
    try {
      if (result.choice === 'Print invoice') await printHtml(invoiceHtml(invoice));
      if (result.choice === 'Share as PDF') await shareHtmlAsPdf(invoiceHtml(invoice), invoice.invoiceNumber || 'Invoice');
    } catch (error) {
      dialog.toast((error as Error).message || 'Could not open the document', 'danger');
    }
    if (result.choice === 'Duplicate as new draft') {
      const fresh = newInvoice(invoice.templateId);
      const { revisionHistory: _h, ...rest } = invoice;
      const copy: Invoice = { ...rest, id: fresh.id, createdAt: fresh.createdAt, updatedAt: fresh.updatedAt, invoiceDate: today(), invoiceNumber: '', status: 'draft', ewbId: undefined, ewbNumber: undefined, idempotencyKey: undefined, extraction: undefined, sourceFileName: undefined, revisionHistory: [], lines: invoice.lines.map((line) => ({ ...line, id: uid('l') })) };
      await store.saveInvoice(copy);
      dialog.toast('Copied as a new draft', 'success');
      router.replace(`/invoice/${copy.id}`);
    }
    if (result.choice === 'Delete draft') {
      const ok = await dialog.confirm({ title: 'Delete this draft?', message: 'It will be removed from all your devices. This cannot be undone.', confirmLabel: 'Delete', cancelLabel: 'Keep', tone: 'danger', icon: 'trash-2' });
      if (ok) {
        await store.removeInvoice(invoice.id);
        dialog.toast('Draft deleted');
        router.back();
      }
    }
  };

  if (!invoice || !totals) {
    return <View style={[styles.loading, { backgroundColor: colors.background }]}><TextBlock color={colors.mutedForeground}>Opening invoice…</TextBlock></View>;
  }

  const header = (
    <ScreenHeader
      title={invoice.invoiceNumber || 'New invoice'}
      subtitle={locked ? `Locked · e-way bill ${invoice.ewbNumber}` : store.storageError || (saveState === 'saving' ? 'Saving…' : `Saved ${store.online === false ? 'on this device' : '· syncs automatically'}`)}
      right={<IconButton icon="more-vertical" accessibilityLabel="More invoice actions" onPress={() => void moreActions()} />}
    />
  );

  if (locked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
          <ProgressSteps steps={['Invoice', 'Review EWB', 'Generated']} current={2} />
          <Notice tone="success" title={`E-way bill ${invoice.ewbNumber} is linked`} body="Generated bills keep the invoice exactly as submitted. To change details, duplicate it as a new draft." action="Open e-way bill" onAction={() => router.push(`/ewb/${invoice.ewbId}`)} />
          <Card>
            <KeyValue label="Invoice date" value={formatDate(invoice.invoiceDate)} />
            <KeyValue label="Seller" value={`${invoice.sellerName}\n${invoice.sellerGstin}`} />
            <KeyValue label="Receiver" value={`${invoice.buyerName}\n${invoice.buyerGstin || 'Unregistered'}`} />
            <KeyValue label="Route" value={`${invoice.sellerState} → ${invoice.buyerState}`} />
            <KeyValue label="Items" value={`${invoice.lines.filter((line) => line.description).length}`} />
            <KeyValue label="Taxable value" value={formatInr(totals.taxable)} />
            <KeyValue label={invoice.supplyType === 'intra' ? 'CGST + SGST' : 'IGST'} value={formatInr(totals.tax)} />
            <KeyValue label="Invoice total" value={formatInr(totals.total)} strong />
          </Card>
          <Button title="Share invoice PDF" icon="share" onPress={() => void shareHtmlAsPdf(invoiceHtml(invoice), invoice.invoiceNumber).catch((error: Error) => dialog.toast(error.message, 'danger'))} />
          <Button title="Duplicate as new draft" icon="copy" variant="outline" onPress={() => void moreActions()} />
        </KeyboardAwareScrollViewCompat>
      </View>
    );
  }

  const fromPdf = (field: string) => (invoice.extraction && !invoice.extraction.confirmed ? invoice.extraction.fields[field] : undefined);
  const sections: Record<Section, ReactNode> = {
    seller: (
      <EditorSection key="seller" title="Seller (you)" icon="briefcase" open={open.seller} onToggle={() => setOpen((c) => ({ ...c, seller: !c.seller }))} errors={sectionErrors('seller')} summary={`${invoice.sellerName || 'Not set'} · ${invoice.sellerGstin || 'No GSTIN'}`}>
        <Field label="Business name" required value={invoice.sellerName} onChangeText={set('sellerName')} placeholder="Legal name" error={errorFor('sellerName')} confidence={fromPdf('sellerName')} />
        <Field label="GSTIN" required value={invoice.sellerGstin} onChangeText={onGstinChange('sellerGstin', 'sellerState')} placeholder="15-character GSTIN" autoCapitalize="characters" maxLength={15} error={errorFor('sellerGstin')} confidence={fromPdf('sellerGstin')} />
        <Field label="Address" value={invoice.sellerAddress} onChangeText={set('sellerAddress')} placeholder="Business address" multiline />
        <View style={styles.row}>
          <View style={{ flex: 1.4 }}><SelectField label="State" required value={invoice.sellerState} placeholder="Choose" options={stateOptions} onSelect={set('sellerState')} error={errorFor('sellerState')} /></View>
          <View style={{ flex: 1 }}><Field label="PIN code" required value={invoice.sellerPincode} onChangeText={(value) => patch({ sellerPincode: value.replace(/\D/g, '').slice(0, 6) })} placeholder="411001" keyboardType="number-pad" error={errorFor('sellerPincode')} confidence={fromPdf('sellerPincode')} /></View>
        </View>
        <Field label="Dispatch from (if different)" value={invoice.dispatchFrom} onChangeText={set('dispatchFrom')} placeholder="Warehouse or factory address" multiline />
      </EditorSection>
    ),
    buyer: (
      <EditorSection key="buyer" title="Buyer / receiver" icon="users" open={open.buyer} onToggle={() => setOpen((c) => ({ ...c, buyer: !c.buyer }))} errors={sectionErrors('buyer')} summary={invoice.buyerName || 'Not set'}>
        {store.parties.length ? <Button title="Choose a saved buyer" icon="user-check" variant="outline" size="sm" onPress={() => setPicker('buyer')} /> : null}
        <Field label="Name" required value={invoice.buyerName} onChangeText={set('buyerName')} placeholder="Business or person" autoCapitalize="words" error={errorFor('buyerName')} confidence={fromPdf('buyerName')} testID="buyer-name" />
        <Field label="GSTIN" value={invoice.buyerGstin} onChangeText={onGstinChange('buyerGstin', 'buyerState')} placeholder="Leave empty or URP if unregistered" autoCapitalize="characters" maxLength={15} error={errorFor('buyerGstin')} confidence={fromPdf('buyerGstin')} />
        <Field label="Address" value={invoice.buyerAddress} onChangeText={set('buyerAddress')} placeholder="Billing address" multiline />
        <View style={styles.row}>
          <View style={{ flex: 1.4 }}><SelectField label="State" required value={invoice.buyerState} placeholder="Choose" options={stateOptions} onSelect={set('buyerState')} error={errorFor('buyerState')} testID="buyer-state" /></View>
          <View style={{ flex: 1 }}><Field label="PIN code" required value={invoice.buyerPincode} onChangeText={(value) => patch({ buyerPincode: value.replace(/\D/g, '').slice(0, 6) })} placeholder="560001" keyboardType="number-pad" error={errorFor('buyerPincode')} confidence={fromPdf('buyerPincode')} testID="buyer-pin" /></View>
        </View>
        <Field label="Ship to (if different)" value={invoice.shipTo} onChangeText={set('shipTo')} placeholder="Delivery address" multiline />
      </EditorSection>
    ),
    invoice: (
      <EditorSection key="invoice" title="Invoice details" icon="hash" open={open.invoice} onToggle={() => setOpen((c) => ({ ...c, invoice: !c.invoice }))} errors={sectionErrors('invoice')} summary={`${invoice.invoiceNumber || 'No number'} · ${formatDate(invoice.invoiceDate)}`}>
        <View style={styles.row}>
          <View style={{ flex: 1.2 }}><Field label="Invoice number" required value={invoice.invoiceNumber} onChangeText={(value) => patch({ invoiceNumber: value.toUpperCase() })} placeholder="INV/26-27/001" autoCapitalize="characters" maxLength={16} error={errorFor('invoiceNumber')} confidence={fromPdf('invoiceNumber')} /></View>
          <View style={{ flex: 1 }}><Field label="Date" required value={invoice.invoiceDate} onChangeText={set('invoiceDate')} placeholder="YYYY-MM-DD" maxLength={10} error={errorFor('invoiceDate')} confidence={fromPdf('invoiceDate')} /></View>
        </View>
        <ChipRow>
          {['Tax invoice', 'Bill of supply', 'Delivery challan', 'Credit note'].map((item) => <Chip key={item} label={item} selected={invoice.documentType === item} onPress={() => patch({ documentType: item })} />)}
        </ChipRow>
        <SelectField label="Place of supply" value={invoice.placeOfSupply} placeholder="Usually the buyer's state" options={stateOptions} onSelect={set('placeOfSupply')} />
        <View style={{ gap: 7 }}>
          <TextBlock size={13} weight="semibold">Supply type</TextBlock>
          <Segmented options={[{ label: 'Within state', value: 'intra' }, { label: 'Inter-state', value: 'inter' }]} value={invoice.supplyType} onChange={(value) => patch({ supplyType: value })} error={errorFor('supplyType')} />
          <TextBlock size={11} color={colors.mutedForeground}>{invoice.supplyType === 'intra' ? 'CGST + SGST are charged.' : 'IGST is charged.'} Set automatically from the two states.</TextBlock>
        </View>
      </EditorSection>
    ),
    items: (
      <EditorSection key="items" title="Products & charges" icon="package" open={open.items} onToggle={() => setOpen((c) => ({ ...c, items: !c.items }))} errors={sectionErrors('items')} summary={`${invoice.lines.length} line${invoice.lines.length === 1 ? '' : 's'} · ${formatInr(totals.total)}`}>
        {errorFor('lines') ? <Notice tone="danger" title={errorFor('lines')!} /> : null}
        {invoice.lines.map((line, index) => (
          <LineEditor
            key={line.id}
            line={line}
            index={index}
            service={invoice.templateId === 'service'}
            supplyType={invoice.supplyType}
            canRemove={invoice.lines.length > 1}
            hasProducts={store.products.length > 0}
            errorFor={(field) => errorFor(`line.${line.id}.${field}`)}
            onChange={(changes) => patchLine(line.id, changes)}
            onRemove={async () => {
              const ok = !line.description && !line.taxablePaise ? true : await dialog.confirm({ title: `Remove line ${index + 1}?`, message: line.description || undefined, confirmLabel: 'Remove', tone: 'danger', icon: 'trash-2' });
              if (ok) patch({ lines: invoice.lines.filter((item) => item.id !== line.id) });
            }}
            onPickProduct={() => setPicker({ line: line.id })}
          />
        ))}
        <Button title="Add another item" icon="plus" variant="outline" onPress={() => patch({ lines: [...invoice.lines, newLine(invoice.templateId)] })} testID="add-line" />
        <View style={[styles.totalsBox, { backgroundColor: colors.muted }]}>
          <KeyValue label="Taxable value" value={formatInr(totals.taxable)} />
          {invoice.supplyType === 'intra' ? <><KeyValue label="CGST" value={formatInr(totals.cgst)} /><KeyValue label="SGST" value={formatInr(totals.sgst)} /></> : <KeyValue label="IGST" value={formatInr(totals.igst)} />}
          <KeyValue label="Invoice total" value={formatInr(totals.total)} strong />
          <TextBlock size={11} color={colors.mutedForeground}>Tax is calculated per line and rounded to the nearest paisa.</TextBlock>
        </View>
      </EditorSection>
    ),
    transport: (
      <EditorSection key="transport" title="Transport (for e-way bill)" icon="truck" open={open.transport} onToggle={() => setOpen((c) => ({ ...c, transport: !c.transport }))} errors={sectionErrors('transport')} summary={`${invoice.transportMode} · ${invoice.vehicleNumber || 'No vehicle'} · ${invoice.distanceKm ? `${invoice.distanceKm} km` : 'Distance not set'}`}>
        {store.transporters.length ? <Button title="Choose a saved transporter" icon="truck" variant="outline" size="sm" onPress={() => setPicker('transporter')} /> : null}
        <Segmented options={TRANSPORT_MODES.map((mode) => ({ label: mode, value: mode }))} value={invoice.transportMode} onChange={set('transportMode')} />
        {invoice.transportMode === 'Road' ? (
          <Field label="Vehicle number" value={invoice.vehicleNumber} onChangeText={(value) => patch({ vehicleNumber: value.toUpperCase().replace(/[\s-]/g, '') })} placeholder="MH12AB1234" autoCapitalize="characters" maxLength={12} error={errorFor('vehicleNumber')} hint="Leave empty if the transporter will add the vehicle later (Part-B)." testID="vehicle" />
        ) : (
          <View style={styles.row}>
            <View style={{ flex: 1 }}><Field label={`${invoice.transportMode} doc no.`} required value={invoice.transportDocNo} onChangeText={set('transportDocNo')} placeholder="RR / AWB / BL no." error={errorFor('transportDocNo')} /></View>
            <View style={{ flex: 1 }}><Field label="Doc date" required value={invoice.transportDocDate} onChangeText={set('transportDocDate')} placeholder="YYYY-MM-DD" maxLength={10} error={errorFor('transportDocDate')} /></View>
          </View>
        )}
        <View style={styles.row}>
          <View style={{ flex: 1 }}><Field label="Distance (km)" required value={invoice.distanceKm} onChangeText={(value) => patch({ distanceKm: value.replace(/\D/g, '').slice(0, 4) })} placeholder="e.g. 840" keyboardType="number-pad" error={errorFor('distanceKm')} testID="distance" /></View>
          <View style={{ flex: 1, gap: 7 }}>
            <TextBlock size={13} weight="semibold">Cargo</TextBlock>
            <Segmented options={[{ label: 'Regular', value: 'regular' }, { label: 'ODC', value: 'odc' }]} value={invoice.vehicleType} onChange={set('vehicleType')} />
          </View>
        </View>
        <Field label="Transporter name" value={invoice.transporterName} onChangeText={set('transporterName')} placeholder="Transport company (optional)" autoCapitalize="words" />
        <Field label="Transporter ID / GSTIN" value={invoice.transporterId} onChangeText={(value) => patch({ transporterId: value.toUpperCase().replace(/\s/g, '') })} placeholder="Optional" autoCapitalize="characters" maxLength={15} error={errorFor('transporterId')} />
        <TextBlock size={11} color={colors.mutedForeground} style={{ lineHeight: 16 }}>Validity: 1 day per 200 km (20 km for over-dimensional cargo). The provider re-checks every value before generating.</TextBlock>
      </EditorSection>
    ),
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bottomOffset={110}>
        <ProgressSteps steps={['Invoice', 'Review EWB', 'Generated']} current={0} />
        {invoice.extraction && !invoice.extraction.confirmed ? (
          <Notice tone="warning" title="Check the values read from your PDF" body={`From ${invoice.sourceFileName ?? 'your PDF'}. Fields tagged “Please check” or “Uncertain” need a careful look — nothing is used until you review it.`} />
        ) : null}
        <View style={{ gap: 7 }}>
          <TextBlock size={13} weight="semibold">Layout</TextBlock>
          <ChipRow>
            {templates.map((template) => <Chip key={template.id} label={template.name} selected={invoice.templateId === template.id} onPress={() => patch({ templateId: template.id, templateVersion: 1 })} />)}
          </ChipRow>
        </View>
        {sectionOrder(invoice.templateId).map((section) => sections[section])}
        <Field label="Notes (printed on invoice)" value={invoice.notes} onChangeText={set('notes')} placeholder="Payment terms, bank details…" multiline />
        {attempted && issues.length ? <Notice tone="danger" title={`${issues.length} item${issues.length === 1 ? '' : 's'} to fix before review`} body={issues.slice(0, 4).map((issue) => issue.message).join(' · ')} /> : null}
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.sticky, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: (Platform.OS === 'web' ? 12 : insets.bottom) + 10 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <TextBlock size={10} weight="semibold" color={colors.mutedForeground} style={{ letterSpacing: 0.8 }}>TOTAL</TextBlock>
          <TextBlock size={19} weight="bold" numberOfLines={1}>{formatInr(totals.total)}</TextBlock>
        </View>
        <Button title="Save" variant="outline" size="sm" onPress={() => void saveDraft()} testID="save-invoice-draft" />
        <Button title="Review EWB" icon="arrow-right" size="sm" onPress={() => void continueToReview()} testID="continue-to-ewb" />
      </View>

      <SelectSheet
        visible={picker === 'buyer'}
        onClose={() => setPicker(null)}
        title="Saved buyers"
        options={store.parties.map((party) => ({ value: party.id, label: party.name, detail: `${party.gstin || 'Unregistered'} · ${party.state}` }))}
        onSelect={(partyId) => {
          const party = store.parties.find((item) => item.id === partyId);
          if (party) patch({ buyerName: party.name, buyerGstin: party.gstin, buyerAddress: party.address, buyerState: party.state, buyerPincode: party.pincode });
        }}
      />
      <SelectSheet
        visible={picker === 'transporter'}
        onClose={() => setPicker(null)}
        title="Saved transporters"
        options={store.transporters.map((item) => ({ value: item.id, label: item.name, detail: [item.transporterId, item.vehicleNumber].filter(Boolean).join(' · ') }))}
        onSelect={(transporterId) => {
          const item = store.transporters.find((candidate) => candidate.id === transporterId);
          if (item) patch({ transporterName: item.name, transporterId: item.transporterId, vehicleNumber: item.vehicleNumber || invoice.vehicleNumber });
        }}
      />
      <SelectSheet
        visible={typeof picker === 'object' && picker !== null}
        onClose={() => setPicker(null)}
        title="Saved products"
        options={store.products.map((product) => ({ value: product.id, label: product.name, detail: `HSN ${product.hsn} · ${product.taxRate}% · ${product.unitPricePaise ? `${formatInr(product.unitPricePaise)}/${product.unit}` : product.unit}` }))}
        onSelect={(productId) => {
          const product = store.products.find((item) => item.id === productId);
          if (product && typeof picker === 'object' && picker) {
            patchLine(picker.line, { description: product.name, hsn: product.hsn, unit: product.unit, taxRate: product.taxRate, unitPricePaise: product.unitPricePaise || undefined });
          }
        }}
      />
    </View>
  );
}

function EditorSection({ title, icon, open, onToggle, errors, summary, children }: { title: string; icon: keyof typeof Feather.glyphMap; open: boolean; onToggle: () => void; errors: number; summary: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <Card style={{ gap: open ? 14 : 0, borderColor: errors ? colors.dangerBorder : colors.border }}>
      <Pressable onPress={onToggle} style={styles.sectionHead} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}${errors ? `, ${errors} to fix` : ''}`}>
        <View style={[styles.sectionIcon, { backgroundColor: errors ? colors.dangerBackground : colors.accent }]}><Feather name={icon} size={16} color={errors ? colors.dangerForeground : colors.primary} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <TextBlock size={15} weight="semibold">{title}</TextBlock>
          {!open ? <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{summary}</TextBlock> : null}
        </View>
        {errors ? <StatusPill label={`${errors} to fix`} tone="red" /> : null}
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      </Pressable>
      {open ? children : null}
    </Card>
  );
}

function LineEditor({ line, index, service, supplyType, canRemove, hasProducts, errorFor, onChange, onRemove, onPickProduct }: {
  line: InvoiceLine; index: number; service: boolean; supplyType: 'intra' | 'inter'; canRemove: boolean; hasProducts: boolean;
  errorFor: (field: keyof InvoiceLine) => string | undefined; onChange: (changes: Partial<InvoiceLine>) => void; onRemove: () => void; onPickProduct: () => void;
}) {
  const colors = useColors();
  const tax = lineTax(line);
  return (
    <View style={[styles.line, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.lineHead}>
        <View style={[styles.lineBadge, { backgroundColor: colors.accent }]}><TextBlock size={11} weight="bold" color={colors.primary}>{index + 1}</TextBlock></View>
        <TextBlock size={13} weight="semibold" style={{ flex: 1 }}>{service ? 'Service' : 'Item'}</TextBlock>
        {hasProducts ? <Pressable onPress={onPickProduct} hitSlop={8} accessibilityRole="button" style={styles.lineAction}><Feather name="bookmark" size={14} color={colors.primary} /><TextBlock size={12} weight="semibold" color={colors.primary}>Saved</TextBlock></Pressable> : null}
        {canRemove ? <IconButton icon="trash-2" color={colors.dangerForeground} onPress={onRemove} accessibilityLabel={`Remove line ${index + 1}`} /> : null}
      </View>
      <Field label={service ? 'Service description' : 'Product / description'} required value={line.description} onChangeText={(value) => onChange({ description: value })} placeholder={service ? 'e.g. Installation charges' : 'e.g. MS steel pipes 2"'} error={errorFor('description')} testID={`line-${index}-desc`} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}><Field label={service ? 'SAC' : 'HSN'} required value={line.hsn} onChangeText={(value) => onChange({ hsn: value.replace(/\D/g, '').slice(0, 8) })} placeholder={service ? '9987' : '7306'} keyboardType="number-pad" error={errorFor('hsn')} testID={`line-${index}-hsn`} /></View>
        <View style={{ flex: 1 }}><Field label={service ? 'Hours / qty' : 'Quantity'} value={line.quantity} onChangeText={(value) => onChange({ quantity: value.replace(/[^0-9.]/g, '') })} placeholder="1" keyboardType="decimal-pad" error={errorFor('quantity')} /></View>
        <View style={{ flex: 0.9 }}><SelectField label="Unit" value={line.unit} placeholder="Nos" options={unitOptions} onSelect={(value) => onChange({ unit: value })} /></View>
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}><MoneyField label="Rate / unit" paise={line.unitPricePaise ?? 0} onChange={(value) => onChange({ unitPricePaise: value || undefined, ...(value ? { taxablePaise: Math.round((Number(line.quantity) || 0) * value) } : {}) })} hint="Optional" /></View>
        <View style={{ flex: 1 }}><MoneyField label="Taxable value" required paise={line.taxablePaise} onChange={(value) => onChange({ taxablePaise: value, unitPricePaise: undefined })} error={errorFor('taxablePaise')} hint={line.unitPricePaise ? 'Qty × rate' : undefined} /></View>
      </View>
      <View style={{ gap: 7 }}>
        <TextBlock size={13} weight="semibold">GST rate</TextBlock>
        <View style={styles.rates}>
          {GST_RATES.map((rate) => (
            <Pressable key={rate} onPress={() => onChange({ taxRate: rate })} accessibilityRole="radio" accessibilityState={{ selected: line.taxRate === rate }} style={[styles.rate, { backgroundColor: line.taxRate === rate ? colors.primary : colors.card, borderColor: line.taxRate === rate ? colors.primary : colors.border }]}>
              <TextBlock size={13} weight="semibold" color={line.taxRate === rate ? colors.primaryForeground : colors.mutedForeground}>{rate}%</TextBlock>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.lineFoot}>
        <TextBlock size={12} color={colors.mutedForeground}>{supplyType === 'intra' ? `CGST ${formatInr(Math.round(tax / 2))} + SGST ${formatInr(tax - Math.round(tax / 2))}` : `IGST ${formatInr(tax)}`}</TextBlock>
        <TextBlock size={14} weight="bold">{formatInr(line.taxablePaise + tax)}</TextBlock>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 30, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 44 },
  sectionIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  line: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 12 },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: 9, marginVertical: -6 },
  lineBadge: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lineAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 4 },
  rates: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  rate: { minWidth: 52, minHeight: 40, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  lineFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  totalsBox: { borderRadius: 14, padding: 13, gap: 8 },
  sticky: { paddingHorizontal: 16, paddingTop: 11, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
