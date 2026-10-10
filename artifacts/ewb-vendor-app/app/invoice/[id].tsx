import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import {
  Button,
  Card,
  Checkbox,
  Field,
  IconButton,
  KeyValue,
  Notice,
  ProgressSteps,
  ScreenHeader,
  Segmented,
  SelectField,
  SelectSheet,
  Sheet,
  StatusPill,
  TextBlock,
} from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { DateField } from '@/components/DateField';
import { InvoicePreview } from '@/components/InvoicePreview';
import { InvoiceProducts } from '@/components/InvoiceProducts';
import { api } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useGstinVerify } from '@/hooks/useGstinVerify';
import {
  expectedSupplyType,
  formatDate,
  formatInr,
  invoiceIssues,
  invoiceTotals,
  STATES,
  stateForGstin,
  gstinProblem,
  transportIssues,
  TRANSPORT_MODES,
  VEHICLE_PATTERN,
  invoiceBank,
  businessNameOf,
  transporterIdProblem,
  hasDispatch,
  hasShipTo,
  routePins,
  invoiceSeriesProblem,
  releasedInvoiceIds,
  type Invoice,
  type Section,
} from '@/lib/domain';
import { invoiceHtml, printHtml, shareHtmlAsPdf } from '@/lib/documents';
import { useAppStore } from '@/state/app-store';

const stateOptions = STATES.map((state) => ({ value: state.name, label: state.name, detail: `Code ${state.code}` }));
const sectionOrder = (templateId: string): Section[] =>
  templateId === 'dispatch' ? ['transport', 'seller', 'buyer', 'invoice', 'items'] : ['seller', 'buyer', 'invoice', 'items', 'transport'];

export default function InvoiceEditorScreen() {
  // view=1: opened from the invoice list, so show the saved invoice as a preview first.
  const { id, view } = useLocalSearchParams<{ id: string; view?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const banks = store.business?.bankAccounts ?? [];
  const dialog = useDialog();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [open, setOpen] = useState<Record<Section, boolean>>({ seller: false, buyer: true, invoice: true, items: true, transport: false });
  const [attempted, setAttempted] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'idle'>('saved');
  const [picker, setPicker] = useState<null | 'buyer' | 'transporter'>(null);
  const [previewing, setPreviewing] = useState(false);
  /** Preview of a saved invoice opened from the list: no Save (it is saved), only Generate EWB. */
  const [viewOnly, setViewOnly] = useState(false);
  const [newTransporter, setNewTransporter] = useState<{ name: string; transporterId: string; phone: string; vehicleNumber: string } | null>(null);
  const [transporterError, setTransporterError] = useState<Record<string, string>>({});
  const [showDispatch, setShowDispatch] = useState(false);
  const [showShipTo, setShowShipTo] = useState(false);
  const [distanceState, setDistanceState] = useState<'idle' | 'loading' | 'error'>('idle');
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || !store.isHydrated) return;
    const found = store.invoices.find((item) => item.id === id);
    loaded.current = true;
    if (found) {
      setInvoice(found);
      // Opening an invoice never re-checks the GSTIN it already has.
      autoVerifiedBuyer.current = found.buyerGstin;
      setShowDispatch(hasDispatch(found));
      setShowShipTo(hasShipTo(found));
      if (view && found.status !== 'draft') {
        setViewOnly(true);
        setPreviewing(true);
      }
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

  // A new invoice stays hidden (unsaved) until it is saved from the preview.
  // Leaving before that discards it, asking first if anything was filled in.
  const navigation = useNavigation();
  const latest = useRef<Invoice | null>(null);
  latest.current = invoice;
  const discarded = useRef(false);
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    const current = latest.current;
    if (!current?.unsaved || discarded.current) return;
    const discard = () => {
      discarded.current = true;
      void store.removeInvoice(current.id).then(() => navigation.dispatch(event.data.action));
    };
    event.preventDefault();
    const touched = current.buyerName.trim() || current.lines.some((line) => line.description.trim() || line.taxablePaise);
    if (!touched) return discard();
    void dialog.confirm({
      title: 'Discard this invoice?',
      message: 'It is not saved yet. Open Preview invoice and tap Save invoice to keep it.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
      icon: 'trash-2',
    }).then((ok) => ok && discard());
  }), [navigation, dialog, store]);

  // Debounced autosave; the explicit "Save draft" button saves immediately.
  useEffect(() => {
    if (!invoice || invoice.status === 'ewb_generated') return;
    setSaveState('saving');
    const timer = setTimeout(() => {
      if (discarded.current) return;
      void store.saveInvoice(invoice).then(() => setSaveState('saved'));
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  const locked = invoice?.status === 'ewb_generated';
  const released = useMemo(() => releasedInvoiceIds(store.invoices, store.ewbs), [store.invoices, store.ewbs]);
  const issues = useMemo(() => (invoice ? [...invoiceIssues(invoice, store.invoices, released), ...transportIssues(invoice)] : []), [invoice, store.invoices, released]);
  // The first invoice of a GSTIN is numbered by the user; later ones continue from it.
  const firstInvoice = useMemo(() => Boolean(invoice) && !store.invoices.some((other) => other.id !== invoice!.id && other.sellerGstin === invoice!.sellerGstin && !other.unsaved && other.invoiceNumber.trim()), [invoice, store.invoices]);
  // Road distance from Google once both PIN codes are known (dispatch / delivery places when given).
  const pins = invoice ? routePins(invoice) : null;
  const pinKey = pins && /^[1-9]\d{5}$/.test(pins.from) && /^[1-9]\d{5}$/.test(pins.to) ? `${pins.from}-${pins.to}` : '';
  const distanceAuto = Boolean(pinKey && invoice?.distanceFor === pinKey);
  useEffect(() => {
    if (!invoice || locked || !pinKey || invoice.distanceFor === pinKey) return;
    // Older invoices keep a distance someone typed before automatic lookup existed.
    if (invoice.distanceFor === undefined && invoice.distanceKm.trim()) return;
    if (store.config?.distanceLookup === false) return;
    let active = true;
    setDistanceState('loading');
    const timer = setTimeout(() => {
      const [from, to] = pinKey.split('-') as [string, string];
      api.distance(from, to)
        .then((result) => {
          if (!active) return;
          setInvoice((current) => (current ? { ...current, distanceKm: String(result.km), distanceFor: pinKey, updatedAt: new Date().toISOString() } : current));
          setDistanceState('idle');
        })
        .catch(() => active && setDistanceState('error'));
    }, 700);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey, invoice?.distanceFor, locked]);

  const errorFor = (field: string) => (attempted ? issues.find((issue) => issue.field === field)?.message : undefined);
  const sectionErrors = (section: Section) => (attempted ? issues.filter((issue) => issue.section === section).length : 0);
  const totals = invoice ? invoiceTotals(invoice) : null;

  const patch = (changes: Partial<Invoice>) => {
    setInvoice((current) => {
      if (!current) return current;
      const next = { ...current, ...changes, updatedAt: new Date().toISOString() };
      if ('sellerState' in changes || 'buyerState' in changes || 'placeOfSupply' in changes) {
        if ('buyerState' in changes && (!current.placeOfSupply || current.placeOfSupply === current.buyerState)) next.placeOfSupply = next.buyerState;
        // Same state as the supplier → CGST + SGST; another state → IGST.
        const expected = expectedSupplyType(next);
        if (expected) next.supplyType = expected;
      }
      // Any edit to a ready invoice sends it back to draft until reviewed again.
      if (current.status === 'ready' && !('status' in changes)) next.status = 'draft';
      return next;
    });
  };
  const set = <K extends keyof Invoice>(key: K) => (value: Invoice[K]) => patch({ [key]: value } as Partial<Invoice>);


  const onGstinChange = (key: 'sellerGstin' | 'buyerGstin', stateKey: 'sellerState' | 'buyerState') => (raw: string) => {
    const value = raw.toUpperCase().replace(/\s/g, '');
    const changes: Partial<Invoice> = { [key]: value };
    if (value.length === 15 && !gstinProblem(value)) changes[stateKey] = stateForGstin(value)?.name ?? '';
    patch(changes);
  };

  const { verify, verifying } = useGstinVerify();
  const canVerify = store.config?.gstinVerification !== false;
  // A full, valid buyer GSTIN fills the buyer's details straight away (once per GSTIN).
  const autoVerifiedBuyer = useRef('');
  const buyerGstinNow = invoice?.buyerGstin ?? '';
  useEffect(() => {
    if (!canVerify || locked || buyerGstinNow.length !== 15 || gstinProblem(buyerGstinNow) || autoVerifiedBuyer.current === buyerGstinNow) return;
    autoVerifiedBuyer.current = buyerGstinNow;
    if (store.parties.some((party) => party.gstin === buyerGstinNow && party.verified)) return;
    void verifyBuyer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyerGstinNow, canVerify]);

  const verifyBuyer = async () => {
    if (!invoice) return;
    const details = await verify(invoice.buyerGstin);
    if (!details) return;
    patch({
      buyerName: businessNameOf(details) || invoice.buyerName,
      buyerAddress: details.address || invoice.buyerAddress,
      buyerPincode: details.pincode || invoice.buyerPincode,
      buyerState: details.state || invoice.buyerState,
    });
    // Remember the verified buyer for next time.
    const existing = store.parties.find((party) => party.gstin === details.gstin);
    await store.saveParty({
      ...(existing ?? { phone: '' }),
      name: businessNameOf(details),
      gstin: details.gstin,
      address: details.address,
      state: details.state,
      pincode: details.pincode,
      verified: { legalName: details.legalName, tradeName: details.tradeName, status: details.status, verifiedAt: details.verifiedAt, city: details.city },
    });
  };

  const showProblems = (problems: { section: Section }[], message: string) => {
    setAttempted(true);
    setOpen((current) => {
      const next = { ...current };
      for (const problem of problems) next[problem.section] = true;
      return next;
    });
    dialog.toast(message, 'danger');
  };

  /** A number outside the latest invoice's series (GR-01 after INV-05): offer the right one. Null to stop. */
  const checkSeries = async (base: Invoice) => {
    const series = invoiceSeriesProblem(base, store.invoices, released);
    if (!series) return base;
    const useNext = await dialog.confirm({
      title: 'Invoice number is wrong',
      message: `${base.invoiceNumber} does not follow your last invoice ${series.latest}. The next number is ${series.next}.`,
      confirmLabel: `Use ${series.next}`,
      cancelLabel: 'Edit number',
      tone: 'warning',
      icon: 'alert-triangle',
    });
    if (!useNext) {
      setPreviewing(false);
      setAttempted(true);
      setOpen((current) => ({ ...current, invoice: true }));
      return null;
    }
    return { ...base, invoiceNumber: series.next };
  };

  const saveNewTransporter = async () => {
    if (!newTransporter) return;
    const problems: Record<string, string> = {};
    if (!newTransporter.name.trim()) problems.name = 'Transporter name is required.';
    const idProblem = transporterIdProblem(newTransporter.transporterId);
    if (idProblem) problems.transporterId = idProblem;
    if (newTransporter.phone && !/^[6-9]\d{9}$/.test(newTransporter.phone.replace(/\D/g, '').slice(-10))) problems.phone = 'Enter a 10-digit mobile number.';
    if (newTransporter.vehicleNumber && !VEHICLE_PATTERN.test(newTransporter.vehicleNumber)) problems.vehicleNumber = 'Format looks wrong (e.g. MH12AB1234).';
    setTransporterError(problems);
    if (Object.keys(problems).length) return;
    await store.saveTransporter({ name: newTransporter.name.trim(), transporterId: newTransporter.transporterId, phone: newTransporter.phone.trim() || undefined, vehicleNumber: newTransporter.vehicleNumber } as never);
    patch({ transporterName: newTransporter.name.trim(), transporterId: newTransporter.transporterId, ...(newTransporter.vehicleNumber && !invoice?.vehicleNumber ? { vehicleNumber: newTransporter.vehicleNumber } : {}) });
    setNewTransporter(null);
    dialog.toast('Transporter saved', 'success');
  };

  /** Remember new buyers and transporters for next time. */
  const rememberDetails = async (saved: Invoice) => {
    const knownBuyer = store.parties.some((party) => (saved.buyerGstin && party.gstin === saved.buyerGstin) || party.name.toLowerCase() === saved.buyerName.trim().toLowerCase());
    if (!knownBuyer) await store.saveParty({ name: saved.buyerName.trim(), gstin: saved.buyerGstin, address: saved.buyerAddress, state: saved.buyerState, pincode: saved.buyerPincode, phone: '' });
    if (saved.transporterName.trim() && !store.transporters.some((item) => item.name.toLowerCase() === saved.transporterName.trim().toLowerCase())) {
      await store.saveTransporter({ name: saved.transporterName.trim(), transporterId: saved.transporterId, vehicleNumber: saved.vehicleNumber });
    }
  };

  /** Right after the number is typed: warn when it leaves the series. */
  const checkNumberNow = async () => {
    if (!invoice || !invoiceSeriesProblem(invoice, store.invoices, released)) return;
    const fixed = await checkSeries(invoice);
    if (fixed && fixed.invoiceNumber !== invoice.invoiceNumber) patch({ invoiceNumber: fixed.invoiceNumber });
  };

  /** Save: check the invoice, then ask whether it needs an e-way bill. */
  const finishInvoice = async () => {
    Keyboard.dismiss();
    if (!invoice) return;
    const checked = await checkSeries(invoice);
    if (!checked) return;
    const problems = invoiceIssues(checked, store.invoices, released);
    setInvoice(checked);
    if (problems.length) {
      setPreviewing(false);
      showProblems(problems, `Fix ${problems.length} item${problems.length === 1 ? '' : 's'} highlighted in red`);
      return;
    }
    const saved: Invoice = { ...checked, status: 'ready', unsaved: false, updatedAt: new Date().toISOString(), extraction: checked.extraction ? { ...checked.extraction, confirmed: true } : undefined };
    setInvoice(saved);
    latest.current = saved;
    await store.saveInvoice(saved);
    setSaveState('saved');
    await rememberDetails(saved);
    setPreviewing(false);
    const answer = await dialog.prompt({
      title: 'Invoice saved. Do you need an e-way bill?',
      message: 'Usually needed when goods worth more than ₹50,000 move. You can also generate it later from this invoice.',
      choices: ['Yes, generate e-way bill now', 'Yes, but generate it later', 'No, e-way bill not required'],
      confirmLabel: 'Continue',
    });
    if (!answer) return;
    if (!answer.choice.endsWith('now')) {
      const later = answer.choice.includes('later');
      latest.current = { ...saved, ewbRequired: later };
      await store.saveInvoice(latest.current);
      dialog.toast(later ? 'Invoice saved · e-way bill pending' : 'Invoice saved', 'success');
      router.replace('/(tabs)/invoices');
      return;
    }
    await continueToReview(saved);
  };

  const continueToReview = async (from?: Invoice) => {
    Keyboard.dismiss();
    if (!invoice) return;
    const checked = from ?? (await checkSeries(invoice));
    if (!checked) return;
    const problems = [...invoiceIssues(checked, store.invoices, released), ...transportIssues(checked)];
    if (checked !== invoice) setInvoice(checked);
    if (problems.length) {
      setPreviewing(false);
      const transportOnly = problems.every((problem) => problem.section === 'transport');
      showProblems(problems, transportOnly ? 'Add the transport details to generate the e-way bill' : `Fix ${problems.length} item${problems.length === 1 ? '' : 's'} highlighted in red`);
      return;
    }
    const ready: Invoice = { ...checked, status: 'ready', ewbRequired: true, unsaved: false, updatedAt: new Date().toISOString(), extraction: checked.extraction ? { ...checked.extraction, confirmed: true } : undefined };
    setInvoice(ready);
    latest.current = ready;
    await store.saveInvoice(ready);
    await rememberDetails(ready);
    setPreviewing(false);
    router.push({ pathname: '/ewb/review/[invoiceId]', params: { invoiceId: ready.id } });
  };

  const moreActions = async () => {
    if (!invoice) return;
    const choices = ['Print invoice', 'Share as PDF', ...(invoice.status === 'draft' ? ['Delete draft'] : [])];
    const result = await dialog.prompt({ title: 'Invoice actions', choices, confirmLabel: 'Continue' });
    if (!result) return;
    try {
      if (result.choice === 'Print invoice') await printHtml(invoiceHtml(invoice));
      if (result.choice === 'Share as PDF') await shareHtmlAsPdf(invoiceHtml(invoice), invoice.invoiceNumber || 'Invoice');
    } catch (error) {
      dialog.toast((error as Error).message || 'Could not open the document', 'danger');
    }
    if (result.choice === 'Delete draft') {
      const ok = await dialog.confirm({ title: 'Delete this draft?', message: 'It will be removed from all your devices. This cannot be undone.', confirmLabel: 'Delete', cancelLabel: 'Keep', tone: 'danger', icon: 'trash-2' });
      if (ok) {
        discarded.current = true;
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
      subtitle={locked ? `Locked · e-way bill ${invoice.ewbNumber}` : invoice.unsaved ? 'Not saved yet · tap Preview invoice to save' : store.storageError || (saveState === 'saving' ? 'Saving…' : `Saved ${store.online === false ? 'on this device' : '· syncs automatically'}`)}
      right={<IconButton icon="more-vertical" accessibilityLabel="More invoice actions" onPress={() => void moreActions()} />}
    />
  );

  if (locked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <KeyboardAwareScrollViewCompat contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
          <ProgressSteps steps={['Invoice', 'Review EWB', 'Generated']} current={2} />
          <Notice tone="success" title={`E-way bill ${invoice.ewbNumber} is generated`} body="Generated bills keep the invoice exactly as submitted." action="Open e-way bill" onAction={() => router.push(`/ewb/${invoice.ewbId}`)} />
          <InvoicePreview invoice={invoice} />
          <Button title="Share invoice PDF" icon="share" onPress={() => void shareHtmlAsPdf(invoiceHtml(invoice), invoice.invoiceNumber).catch((error: Error) => dialog.toast(error.message, 'danger'))} />
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
        <Checkbox checked={showDispatch} onToggle={() => {
          if (showDispatch) patch({ dispatchFrom: '', dispatchState: '', dispatchPincode: '' });
          setShowDispatch(!showDispatch);
        }} label="Goods dispatch from a different place" testID="toggle-dispatch" />
        {showDispatch ? (
          <View style={{ gap: 12 }}>
            <Field label="Dispatch address" value={invoice.dispatchFrom} onChangeText={set('dispatchFrom')} placeholder="Warehouse or factory address" multiline />
            <View style={styles.row}>
              <View style={{ flex: 1.4 }}><SelectField label="Dispatch state" required value={invoice.dispatchState} placeholder="Choose" options={stateOptions} onSelect={set('dispatchState')} error={errorFor('dispatchState')} /></View>
              <View style={{ flex: 1 }}><Field label="PIN code" required value={invoice.dispatchPincode} onChangeText={(value) => patch({ dispatchPincode: value.replace(/\D/g, '').slice(0, 6) })} placeholder="411019" keyboardType="number-pad" error={errorFor('dispatchPincode')} testID="dispatch-pin" /></View>
            </View>
          </View>
        ) : null}
      </EditorSection>
    ),
    buyer: (
      <EditorSection key="buyer" title="Buyer" icon="users" open={open.buyer} onToggle={() => setOpen((c) => ({ ...c, buyer: !c.buyer }))} errors={sectionErrors('buyer')} summary={invoice.buyerName || 'Not set'}>
        {store.parties.length ? <Button title="Choose a saved buyer" icon="user-check" variant="outline" size="sm" onPress={() => setPicker('buyer')} /> : null}
        <Field label="GSTIN" value={invoice.buyerGstin} onChangeText={onGstinChange('buyerGstin', 'buyerState')} placeholder="Enter GSTIN to fill the details" autoCapitalize="characters" maxLength={15} error={errorFor('buyerGstin')} confidence={fromPdf('buyerGstin')}
          right={canVerify && invoice.buyerGstin.length === 15 && !store.parties.some((party) => party.gstin === invoice.buyerGstin && party.verified) ? <Button title="Verify" size="sm" variant="outline" onPress={() => void verifyBuyer()} loading={verifying} testID="buyer-verify" /> : undefined}
          hint={store.parties.some((party) => party.gstin === invoice.buyerGstin && party.verified) ? 'Verified buyer' : verifying ? 'Getting details from the GST network…' : canVerify ? 'Name, address, state and PIN fill in automatically. Leave empty if unregistered.' : 'Leave empty if unregistered.'}
          testID="buyer-gstin" />
        <Field label="Business name" required value={invoice.buyerName} onChangeText={set('buyerName')} placeholder="Business or person" autoCapitalize="words" error={errorFor('buyerName')} confidence={fromPdf('buyerName')} testID="buyer-name" />
        <Field label="Address" value={invoice.buyerAddress} onChangeText={set('buyerAddress')} placeholder="Billing address" multiline />
        <View style={styles.row}>
          <View style={{ flex: 1.4 }}><SelectField label="State" required value={invoice.buyerState} placeholder="Choose" options={stateOptions} onSelect={set('buyerState')} error={errorFor('buyerState')} testID="buyer-state" /></View>
          <View style={{ flex: 1 }}><Field label="PIN code" required value={invoice.buyerPincode} onChangeText={(value) => patch({ buyerPincode: value.replace(/\D/g, '').slice(0, 6) })} placeholder="560001" keyboardType="number-pad" error={errorFor('buyerPincode')} confidence={fromPdf('buyerPincode')} testID="buyer-pin" /></View>
        </View>
        <Checkbox checked={showShipTo} onToggle={() => {
          if (showShipTo) patch({ shipTo: '', shipToState: '', shipToPincode: '' });
          setShowShipTo(!showShipTo);
        }} label="Ship to a different address" testID="toggle-ship-to" />
        {showShipTo ? (
          <View style={{ gap: 12 }}>
            <Field label="Delivery address" value={invoice.shipTo} onChangeText={set('shipTo')} placeholder="Where the goods are delivered" multiline />
            <View style={styles.row}>
              <View style={{ flex: 1.4 }}><SelectField label="Delivery state" required value={invoice.shipToState} placeholder="Choose" options={stateOptions} onSelect={set('shipToState')} error={errorFor('shipToState')} /></View>
              <View style={{ flex: 1 }}><Field label="PIN code" required value={invoice.shipToPincode} onChangeText={(value) => patch({ shipToPincode: value.replace(/\D/g, '').slice(0, 6) })} placeholder="560058" keyboardType="number-pad" error={errorFor('shipToPincode')} testID="ship-to-pin" /></View>
            </View>
          </View>
        ) : null}
      </EditorSection>
    ),
    invoice: (
      <EditorSection key="invoice" title="Invoice details" icon="hash" open={open.invoice} onToggle={() => setOpen((c) => ({ ...c, invoice: !c.invoice }))} errors={sectionErrors('invoice')} summary={`${invoice.invoiceNumber || 'No number'} · ${formatDate(invoice.invoiceDate)}`}>
        <View style={styles.row}>
          <View style={{ flex: 1.2 }}><Field label="Invoice number" required value={invoice.invoiceNumber} onChangeText={(value) => patch({ invoiceNumber: value.replace(/\s/g, '') })} placeholder="e.g. INV-001 or GR-1" autoCapitalize="none" maxLength={16} onBlur={() => void checkNumberNow()} error={errorFor('invoiceNumber')} confidence={fromPdf('invoiceNumber')} hint={firstInvoice ? 'Your first invoice: enter its number. Next invoices continue from it.' : undefined} /></View>
          <View style={{ flex: 1 }}><DateField label="Date" required value={invoice.invoiceDate} onChange={set('invoiceDate')} error={errorFor('invoiceDate')} testID="invoice-date" /></View>
        </View>
        <SelectField label="Document type" value={invoice.documentType} placeholder="Tax invoice" title="Document type" options={DOCUMENT_TYPES.map((item) => ({ value: item, label: item }))} onSelect={set('documentType')} testID="document-type" />
        <SelectField label="Place of supply" value={invoice.placeOfSupply} placeholder="Usually the buyer's state" options={stateOptions} onSelect={set('placeOfSupply')} />
        <View style={{ gap: 7 }}>
          <TextBlock size={13} weight="semibold">Supply type</TextBlock>
          <View style={[styles.supply, { backgroundColor: colors.muted }]}>
            <TextBlock size={14} weight="semibold">{invoice.supplyType === 'intra' ? 'Within state · CGST + SGST' : 'Inter-state · IGST'}</TextBlock>
            <TextBlock size={11} color={colors.mutedForeground}>Set automatically: supplier in {invoice.sellerState || '—'}, place of supply {invoice.placeOfSupply || invoice.buyerState || '—'}.</TextBlock>
          </View>
        </View>
      </EditorSection>
    ),
    items: (
      <EditorSection key="items" title="Products" icon="package" open={open.items} onToggle={() => setOpen((c) => ({ ...c, items: !c.items }))} errors={sectionErrors('items')} summary={`${invoice.lines.filter((line) => line.description.trim()).length} product${invoice.lines.filter((line) => line.description.trim()).length === 1 ? '' : 's'} · ${formatInr(totals.total)}`}>
        <InvoiceProducts
          lines={invoice.lines}
          products={store.products}
          error={errorFor('lines')}
          lineError={(lineId) => attempted ? issues.find((issue) => issue.field.startsWith(`line.${lineId}.`))?.message : undefined}
          onChange={(lines) => patch({ lines })}
          onSaveProduct={(product) => void store.saveProduct(product as never)}
        />
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
        <Segmented options={TRANSPORT_MODES.map((mode) => ({ label: mode, value: mode }))} value={invoice.transportMode} onChange={set('transportMode')} />
        <View style={{ gap: 7 }}>
          <TextBlock size={13} weight="semibold">Transporter</TextBlock>
          <Pressable onPress={() => setPicker('transporter')} accessibilityRole="button" accessibilityLabel={invoice.transporterName ? `Transporter ${invoice.transporterName}. Change` : 'Choose transporter'} testID="pick-transporter"
            style={({ pressed }) => [styles.pickRow, { borderColor: errorFor('transporterId') ? colors.destructive : colors.input, backgroundColor: colors.card, opacity: pressed ? 0.85 : 1 }]}>
            <Feather name="truck" size={17} color={colors.primary} />
            <View style={{ flex: 1, gap: 1 }}>
              <TextBlock size={15} weight={invoice.transporterName ? 'semibold' : 'regular'} color={invoice.transporterName ? undefined : colors.mutedForeground}>{invoice.transporterName || 'Choose from transporter list'}</TextBlock>
              {invoice.transporterName ? <TextBlock size={12} color={colors.mutedForeground}>{invoice.transporterId ? `ID ${invoice.transporterId}` : 'No transporter ID'}</TextBlock> : null}
            </View>
            {invoice.transporterName
              ? <Pressable onPress={() => patch({ transporterName: '', transporterId: '' })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove transporter"><Feather name="x" size={18} color={colors.mutedForeground} /></Pressable>
              : <Feather name="chevron-down" size={18} color={colors.mutedForeground} />}
          </Pressable>
          {errorFor('transporterId') ? <TextBlock size={12} color={colors.destructive}>{errorFor('transporterId')}</TextBlock> : <TextBlock size={11} color={colors.mutedForeground}>Optional. Not in the list? Add it from the list.</TextBlock>}
        </View>
        {invoice.transportMode !== 'Road' ? (
          <View style={styles.row}>
            <View style={{ flex: 1 }}><Field label={`${invoice.transportMode} doc no.`} required value={invoice.transportDocNo} onChangeText={set('transportDocNo')} placeholder="RR / AWB / BL no." error={errorFor('transportDocNo')} /></View>
            <View style={{ flex: 1 }}><DateField label="Doc date" required value={invoice.transportDocDate} onChange={set('transportDocDate')} error={errorFor('transportDocDate')} /></View>
          </View>
        ) : null}
        <View style={styles.row}>
          <View style={{ flex: 1 }}><Field label="Distance (km)" required value={invoice.distanceKm} onChangeText={(value) => patch({ distanceKm: value.replace(/\D/g, '').slice(0, 4) })} placeholder={distanceState === 'loading' ? 'Getting…' : 'e.g. 840'} keyboardType="number-pad" error={errorFor('distanceKm')} testID="distance"
            hint={distanceState === 'loading' ? 'Getting road distance from Google…' : distanceAuto ? `From Google maps: ${pins!.from} → ${pins!.to}. You can change it.` : distanceState === 'error' ? 'Could not get the distance. Enter it manually.' : pinKey ? undefined : 'Filled automatically from the PIN codes.'} /></View>
          <View style={{ flex: 1, gap: 7 }}>
            <TextBlock size={13} weight="semibold">Cargo</TextBlock>
            <Segmented options={[{ label: 'Regular', value: 'regular' }, { label: 'ODC', value: 'odc' }]} value={invoice.vehicleType} onChange={set('vehicleType')} />
          </View>
        </View>
        {invoice.transportMode === 'Road' ? (
          <Field label="Vehicle number" value={invoice.vehicleNumber} onChangeText={(value) => patch({ vehicleNumber: value.toUpperCase().replace(/[\s-]/g, '') })} placeholder="MH12AB1234" autoCapitalize="characters" maxLength={12} error={errorFor('vehicleNumber')} hint="Leave empty if the transporter will add the vehicle later (Part-B)." testID="vehicle" />
        ) : null}
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
        {sectionOrder(invoice.templateId).map((section) => sections[section])}
        {banks.length ? (
          <SelectField
            label="Bank details on invoice"
            value={invoice.bank?.id ?? NO_BANK}
            placeholder="Choose bank account"
            title="Bank details on invoice"
            options={[...banks.map((bank) => ({ value: bank.id, label: bank.bankName, detail: `A/c ${bank.accountNumber} · ${bank.ifsc}` })), { value: NO_BANK, label: 'Do not print bank details' }]}
            onSelect={(id) => {
              const bank = banks.find((item) => item.id === id);
              patch({ bank: bank ? invoiceBank(bank) : null });
            }}
            testID="invoice-bank"
          />
        ) : (
          <Card style={styles.bankEmpty}>
            <View style={{ flex: 1, gap: 2 }}>
              <TextBlock size={14} weight="semibold">Bank details</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground}>Add a bank account to print it on your invoices.</TextBlock>
            </View>
            <Button title="Add bank" icon="plus" size="sm" variant="outline" onPress={() => router.push('/bank-details')} testID="invoice-add-bank" />
          </Card>
        )}
        <Field label="Notes (printed on invoice)" value={invoice.notes} onChangeText={set('notes')} placeholder="Payment terms, delivery notes…" multiline />
        {attempted && issues.length ? <Notice tone="danger" title={`${issues.length} item${issues.length === 1 ? '' : 's'} to fix before review`} body={issues.slice(0, 4).map((issue) => issue.message).join(' · ')} /> : null}
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.sticky, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: (Platform.OS === 'web' ? 12 : insets.bottom) + 10 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <TextBlock size={10} weight="semibold" color={colors.mutedForeground} style={{ letterSpacing: 0.8 }}>TOTAL</TextBlock>
          <TextBlock size={19} weight="bold" numberOfLines={1}>{formatInr(totals.total)}</TextBlock>
        </View>
        <Button title="Preview invoice" icon="eye" size="sm" onPress={() => { Keyboard.dismiss(); setViewOnly(false); setPreviewing(true); }} testID="preview-invoice" />
      </View>

      <Modal visible={previewing} animationType={viewOnly ? 'none' : 'slide'} onRequestClose={() => (viewOnly ? router.back() : setPreviewing(false))}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <ScreenHeader
            title={viewOnly ? invoice.invoiceNumber || 'Invoice' : 'Invoice preview'}
            subtitle={viewOnly ? `${invoice.buyerName || 'No buyer'} · ${invoice.ewbRequired === false ? 'E-way bill not required' : 'E-way bill pending'}` : 'Check everything before saving'}
            onBack={() => { if (viewOnly) { setPreviewing(false); router.back(); } else setPreviewing(false); }}
            right={<Button title="Edit" icon="edit-2" variant="outline" size="sm" onPress={() => { setViewOnly(false); setPreviewing(false); }} testID="preview-edit" />} />
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 24 }]}>
            <InvoicePreview invoice={invoice} />
          </ScrollView>
          <View style={[styles.sticky, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: (Platform.OS === 'web' ? 12 : insets.bottom) + 10 }]}>
            <Button title="Generate EWB" icon="truck" variant={viewOnly ? 'primary' : 'outline'} onPress={() => void continueToReview()} style={{ flex: 1 }} testID="continue-to-ewb" />
            {viewOnly ? null : <Button title="Save invoice" icon="check" onPress={() => void finishInvoice()} style={{ flex: 1 }} testID="save-invoice" />}
          </View>
        </View>
      </Modal>

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
        title="Choose transporter"
        emptyText="No transporters saved yet."
        footer={<Button title="Add new transporter" icon="plus" variant="outline" onPress={() => { setPicker(null); setTransporterError({}); setTimeout(() => setNewTransporter({ name: '', transporterId: '', phone: '', vehicleNumber: '' }), 250); }} testID="new-transporter" />}
        options={store.transporters.map((item) => ({ value: item.id, label: item.name, detail: [item.transporterId, item.vehicleNumber].filter(Boolean).join(' · ') || 'No ID saved' }))}
        onSelect={(transporterId) => {
          const item = store.transporters.find((candidate) => candidate.id === transporterId);
          if (item) patch({ transporterName: item.name, transporterId: item.transporterId, vehicleNumber: item.vehicleNumber || invoice.vehicleNumber });
        }}
      />
      <Sheet
        visible={Boolean(newTransporter)}
        onClose={() => setNewTransporter(null)}
        title="New transporter"
        subtitle="Saved to your transporter list"
        footer={<Button title="Save and use" icon="check" onPress={() => void saveNewTransporter()} testID="save-transporter" />}
      >
        {newTransporter ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            <Field label="Transporter name" required value={newTransporter.name} onChangeText={(name) => setNewTransporter({ ...newTransporter, name })} error={transporterError.name} autoCapitalize="words" testID="transporter-name" />
            <Field label="Transporter ID / GSTIN" required value={newTransporter.transporterId} onChangeText={(value) => setNewTransporter({ ...newTransporter, transporterId: value.toUpperCase().replace(/\s/g, '') })} error={transporterError.transporterId} autoCapitalize="characters" maxLength={15} placeholder="15-character ID" testID="transporter-id" />
            <Field label="Phone number" value={newTransporter.phone} onChangeText={(phone) => setNewTransporter({ ...newTransporter, phone })} error={transporterError.phone} keyboardType="phone-pad" maxLength={14} placeholder="Optional" />
            <Field label="Usual vehicle number" value={newTransporter.vehicleNumber} onChangeText={(value) => setNewTransporter({ ...newTransporter, vehicleNumber: value.toUpperCase().replace(/[\s-]/g, '') })} error={transporterError.vehicleNumber} autoCapitalize="characters" maxLength={12} placeholder="Optional" />
          </View>
        ) : null}
      </Sheet>
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


const NO_BANK = 'none';
const DOCUMENT_TYPES = ['Tax invoice', 'Bill of supply', 'Delivery challan', 'Credit note'];

const styles = StyleSheet.create({
  bankEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  supply: { borderRadius: 12, padding: 12, gap: 3 },
  pickRow: { minHeight: 56, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 11 },
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
