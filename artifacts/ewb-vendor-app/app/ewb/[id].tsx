import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, EmptyState, IconButton, KeyValue, Notice, ScreenHeader, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { ActionCard, ActionGrid } from '@/components/ActionCard';
import { EwbPreview } from '@/components/EwbPreview';
import { useColors } from '@/hooks/useColors';
import { useCredits } from '@/hooks/useCredits';
import { api, ApiError } from '@/lib/api';
import {
  CANCEL_REASONS,
  ewbStatusMeta,
  EXTEND_REASONS,
  formatDate,
  formatInr,
  liveEwbStatus,
  relativeTime,
  VEHICLE_PATTERN,
  VEHICLE_REASONS,
  type EwbRecord,
} from '@/lib/domain';
import { ewbHtml, printHtml, shareHtmlAsPdf } from '@/lib/documents';
import { useAppStore } from '@/state/app-store';

const HOUR = 3_600_000;

export default function EwbDetailScreen() {
  const { id, action } = useLocalSearchParams<{ id: string; action?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const credits = useCredits();
  const cached = store.ewbs.find((item) => item.id === id) ?? null;
  const [fetched, setEwb] = useState<EwbRecord | null>(null);
  // Prefer the freshest copy: server response, else the device cache (which hydrates after first render).
  const ewb = fetched ?? cached;
  const [refreshing, setRefreshing] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [preview, setPreview] = useState(false);
  // Lets the E-way bills tab open a bill straight into Part-B or cancel (?action=part_b|cancel).
  const actions = useRef<Record<string, () => void>>({});
  const actionDone = useRef(false);

  const refresh = useCallback(async (announce = false) => {
    if (!store.workspaceId) return;
    setRefreshing(true);
    try {
      const result = await api.getEwb(id);
      setEwb(result.ewb);
      store.upsertEwb(result.ewb);
      setFresh(true);
      if (announce) dialog.toast('Status refreshed from provider', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setNotFound(true);
      else if (announce) dialog.toast(error instanceof ApiError ? error.message : 'Could not refresh', 'danger');
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, store.workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keyed on the bill ID so a refresh (new object, same bill) does not cancel the pending action.
  const loadedId = ewb?.id;
  useEffect(() => {
    if (!action || actionDone.current || !loadedId) return;
    actionDone.current = true;
    const timer = setTimeout(() => actions.current[action]?.(), 400);
    return () => clearTimeout(timer);
  }, [action, loadedId]);

  if (!ewb) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="E-way bill" />
        <View style={{ padding: 20 }}>
          {notFound || store.online === false ? (
            <Card><EmptyState icon="truck" title={notFound ? 'Bill not found' : 'Not available offline'} body={notFound ? 'This bill is not in your workspace.' : 'Connect to load this bill for the first time.'} action={<Button title="Back to e-way bills" variant="outline" onPress={() => router.replace('/(tabs)/ewbs')} />} /></Card>
          ) : <TextBlock color={colors.mutedForeground}>Loading bill…</TextBlock>}
        </View>
      </View>
    );
  }

  const status = liveEwbStatus(ewb);
  const meta = ewbStatusMeta(status);
  const sandbox = ewb.provider === 'sandbox';
  const now = Date.now();
  const validUntil = Date.parse(ewb.validUntil);
  const generatedAt = Date.parse(ewb.generatedAt);
  const totalSpan = validUntil - generatedAt;
  const progress = Math.min(1, Math.max(0, (now - generatedAt) / totalSpan));
  const canCancel = status !== 'cancelled' && now - generatedAt <= 24 * HOUR;
  const canExtend = status !== 'cancelled' && Math.abs(now - validUntil) <= 8 * HOUR;
  const canUpdateVehicle = (status === 'active' || status === 'part_b_pending') && !ewb.consolidatedInto;
  const invoice = store.invoices.find((item) => item.id === ewb.invoiceId);

  const runAction = async (label: string, body: Parameters<typeof api.ewbAction>[1], success: string) => {
    setBusy(label);
    try {
      const result = await api.ewbAction(ewb.id, body);
      setEwb(result.ewb);
      store.upsertEwb(result.ewb);
      store.setWalletBalance(result.balance);
      void store.refreshWallet();
      dialog.toast(success, 'success');
    } catch (error) {
      if (await credits.handleError(error)) return;
      await dialog.alert({ title: `Could not ${label.toLowerCase()}`, message: error instanceof ApiError ? error.message : 'Check your connection and try again.', tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const updateVehicle = async () => {
    const result = await dialog.prompt({
      title: 'Update vehicle (Part-B)',
      message: `Enter the new vehicle carrying these goods.${credits.costs.part_b ? ` Uses ${credits.costs.part_b} credits.` : ''}`,
      choices: VEHICLE_REASONS,
      inputLabel: 'New vehicle number',
      placeholder: 'MH12AB1234',
      autoCapitalize: 'characters',
      requireInput: true,
      confirmLabel: 'Update vehicle',
      validate: ({ text }) => (VEHICLE_PATTERN.test(text.replace(/[\s-]/g, '').toUpperCase()) ? null : 'Format looks wrong (e.g. MH12AB1234).'),
    });
    if (!result) return;
    const where = await dialog.prompt({
      title: 'Where is the vehicle now?',
      message: 'The e-way bill portal records the place the goods move from with the new vehicle.',
      inputLabel: 'Current place (city or town)',
      placeholder: 'e.g. Satara',
      defaultValue: store.business?.verified?.city ?? '',
      autoCapitalize: 'words',
      requireInput: true,
      confirmLabel: 'Continue',
    });
    if (!where) return;
    if (!(await credits.confirmSpend('part_b', 'Updating Part-B'))) return;
    await runAction('Update vehicle', { action: 'update_vehicle', reason: result.choice, vehicleNumber: result.text, fromPlace: where.text.trim(), fromState: ewb.fromState }, 'Vehicle updated');
  };

  const extend = async () => {
    const result = await dialog.prompt({
      title: 'Extend validity',
      message: 'Allowed within 8 hours before or after expiry, when goods are still in transit.',
      choices: EXTEND_REASONS,
      inputLabel: 'Remaining distance (km)',
      placeholder: 'e.g. 150',
      keyboardType: 'number-pad',
      requireInput: true,
      confirmLabel: 'Extend',
      validate: ({ text }) => (Number.isInteger(Number(text)) && Number(text) > 0 && Number(text) <= 4000 ? null : 'Enter 1–4000 km.'),
    });
    if (!result) return;
    const place = await dialog.prompt({
      title: 'Where are the goods now?',
      inputLabel: 'Current place (city or town)',
      placeholder: 'e.g. Satara',
      defaultValue: store.business?.verified?.city ?? '',
      autoCapitalize: 'words',
      requireInput: true,
      confirmLabel: 'Continue',
    });
    if (!place) return;
    const pin = await dialog.prompt({
      title: 'PIN code of that place',
      inputLabel: 'PIN code',
      placeholder: '415001',
      defaultValue: store.business?.pincode ?? '',
      keyboardType: 'number-pad',
      requireInput: true,
      confirmLabel: 'Continue',
      validate: ({ text }) => (/^[1-9]\d{5}$/.test(text.trim()) ? null : 'Enter a 6-digit PIN code.'),
    });
    if (!pin) return;
    if (!(await credits.confirmSpend('extend', 'Extending validity'))) return;
    await runAction('Extend validity', { action: 'extend', reason: result.choice, remainingKm: Number(result.text), fromPlace: place.text.trim(), fromState: ewb.fromState, fromPincode: pin.text.trim() }, 'Validity extended');
  };

  const cancel = async () => {
    const result = await dialog.prompt({
      title: 'Cancel this e-way bill?',
      message: `Cancelling ${ewb.ewbNumber} is permanent and is reported to the provider. Goods cannot move on a cancelled bill.${credits.costs.cancel ? ` Uses ${credits.costs.cancel} credits.` : ''} Choose a reason:`,
      choices: CANCEL_REASONS,
      confirmLabel: 'Cancel bill',
      tone: 'danger',
    });
    if (!result) return;
    const cost = credits.costs.cancel;
    if (cost && credits.balance !== null && credits.balance < cost) {
      await credits.confirmSpend('cancel', 'Cancelling an e-way bill');
      return;
    }
    const sure = await dialog.confirm({ title: 'Are you sure?', message: `This cannot be undone. The invoice will become available to generate a new bill.${cost ? ` ${cost} credits will be used${credits.balance !== null ? ` (balance ${credits.balance} → ${credits.balance - cost})` : ''}.` : ''}`, confirmLabel: cost ? `Yes, cancel · ${cost} credits` : 'Yes, cancel bill', cancelLabel: 'Keep bill', tone: 'danger', icon: 'x-octagon' });
    if (sure) await runAction('Cancel', { action: 'cancel', reason: result.choice }, 'E-way bill cancelled');
  };

  const shareText = async () => {
    await Share.share({
      message: `E-way bill ${ewb.ewbNumber}${sandbox ? ' (SANDBOX — not valid)' : ''}\nInvoice ${ewb.invoiceNumber} · ${formatInr(ewb.totals.total)}\nFrom ${ewb.sellerName} (${ewb.fromState}) to ${ewb.buyerName} (${ewb.toState})\nVehicle ${ewb.transport.vehicleNumber || 'pending'} · Valid until ${formatDate(ewb.validUntil, true)}`,
    }).catch(() => undefined);
  };

  const docAction = async (kind: 'print' | 'share') => {
    try {
      if (kind === 'print') await printHtml(ewbHtml(ewb, sandbox));
      else await shareHtmlAsPdf(ewbHtml(ewb, sandbox), `EWB ${ewb.ewbNumber}`);
    } catch (error) {
      dialog.toast((error as Error).message || 'Could not create the PDF', 'danger');
    }
  };

  actions.current = { part_b: () => void updateVehicle(), cancel: () => void cancel(), extend: () => void extend() };
  const consolidate = () => router.push({ pathname: '/ewb/consolidate', params: { ids: ewb.id } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <EwbPreview ewb={ewb} visible={preview} onClose={() => setPreview(false)} sandbox={sandbox} />
      <ScreenHeader title="E-way bill" subtitle={`${ewb.invoiceNumber} · ${ewb.buyerName}`} right={<IconButton icon="share-2" accessibilityLabel="Share bill summary" onPress={() => void shareText()} />} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
        {sandbox ? <Notice tone="warning" title="Sandbox bill — not valid for transport" body="Generated by the test provider. Connect an authorized GSP before real use." /> : null}
        {!fresh ? <Notice title={store.online === false ? 'Offline copy' : 'Showing saved copy'} body={`Last verified ${formatDate(ewb.lastVerifiedAt, true)}. ${refreshing ? 'Checking provider…' : ''}`} /> : null}

        <Card style={styles.hero}>
          <View style={styles.heroTop}>
            <StatusPill label={meta.label} tone={meta.tone} />
            <TextBlock size={11} color={colors.mutedForeground}>{ewb.validityDays} day validity{ewb.extensionCount ? ` · extended ${ewb.extensionCount}×` : ''}</TextBlock>
          </View>
          <TextBlock size={12} weight="semibold" color={colors.mutedForeground} style={{ letterSpacing: 1 }}>E-WAY BILL NUMBER</TextBlock>
          <TextBlock size={30} weight="bold" style={{ letterSpacing: 2.5 }} selectable>{ewb.ewbNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}</TextBlock>
          {status !== 'cancelled' ? (
            <View style={{ gap: 6 }}>
              <View style={[styles.track, { backgroundColor: colors.muted }]}>
                <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: status === 'expired' ? colors.mutedForeground : validUntil - now < 8 * HOUR ? colors.destructive : colors.primary }]} />
              </View>
              <View style={styles.trackLabels}>
                <TextBlock size={11} color={colors.mutedForeground}>{formatDate(ewb.generatedAt, true)}</TextBlock>
                <TextBlock size={11} weight="semibold" color={status === 'expired' ? colors.mutedForeground : validUntil - now < 8 * HOUR ? colors.dangerForeground : colors.foreground}>
                  {status === 'expired' ? `Expired ${relativeTime(ewb.validUntil)}` : `Expires ${relativeTime(ewb.validUntil)}`}
                </TextBlock>
              </View>
            </View>
          ) : <Notice tone="danger" title={`Cancelled ${formatDate(ewb.cancelledAt ?? ewb.generatedAt, true)}`} body={`Reason: ${ewb.cancelReason ?? '—'}`} />}
        </Card>

        <ActionGrid>
          <ActionCard icon="download" title={Platform.OS === 'web' ? 'Save PDF' : 'Download'} detail="PDF to save or share" onPress={() => void docAction('share')} testID="ewb-download" />
          <ActionCard icon="printer" title="Print" detail="Print a paper copy" onPress={() => void docAction('print')} testID="ewb-print" />
          <ActionCard icon="eye" title="Preview" detail="See the bill as it prints" onPress={() => setPreview(true)} testID="ewb-preview" />
          <ActionCard icon="x-octagon" title="Cancel" danger detail={status === 'cancelled' ? 'Already cancelled' : canCancel ? `${credits.costs.cancel} credits · within 24 h` : '24-hour window closed'} disabled={!canCancel} busy={busy === 'Cancel'} onPress={() => void cancel()} testID="ewb-cancel" />
        </ActionGrid>

        {ewb.status === 'part_b_pending' && status !== 'expired' ? <Notice tone="warning" title="Vehicle details pending" body="Goods cannot move until a vehicle number is added (Part-B)." action="Add vehicle" onAction={() => void updateVehicle()} /> : null}

        <Card>
          <SectionHead icon="map-pin" title="Route" />
          <View style={styles.route}>
            <View style={{ flex: 1, gap: 3 }}>
              <TextBlock size={11} color={colors.mutedForeground}>FROM</TextBlock>
              <TextBlock size={14} weight="semibold">{ewb.sellerName}</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground}>{ewb.sellerGstin}</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground}>{ewb.fromState}</TextBlock>
            </View>
            <Feather name="arrow-right" size={18} color={colors.primary} />
            <View style={{ flex: 1, gap: 3, alignItems: 'flex-end' }}>
              <TextBlock size={11} color={colors.mutedForeground}>TO</TextBlock>
              <TextBlock size={14} weight="semibold" style={{ textAlign: 'right' }}>{ewb.buyerName}</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground}>{ewb.buyerGstin}</TextBlock>
              <TextBlock size={12} color={colors.mutedForeground}>{ewb.toState}</TextBlock>
            </View>
          </View>
        </Card>

        <Card>
          <SectionHead icon="file-text" title="Document & goods" />
          <Pressable onPress={() => invoice && router.push(`/invoice/${invoice.id}`)} disabled={!invoice} accessibilityRole="link">
            <KeyValue label="Source invoice" value={`${ewb.invoiceNumber} · ${formatDate(ewb.invoiceDate)}${invoice ? '  ›' : ''}`} />
          </Pressable>
          {ewb.lines.map((line, index) => (
            <View key={`${line.hsn}${index}`} style={styles.item}>
              <View style={{ flex: 1, gap: 2 }}>
                <TextBlock size={13} weight="medium">{line.description}</TextBlock>
                <TextBlock size={11} color={colors.mutedForeground}>HSN {line.hsn} · {line.quantity} {line.unit} · {line.taxRate}%</TextBlock>
              </View>
              <TextBlock size={13} weight="semibold">{formatInr(line.taxablePaise)}</TextBlock>
            </View>
          ))}
          <Divider />
          <KeyValue label="Taxable value" value={formatInr(ewb.totals.taxable)} />
          <KeyValue label="Tax" value={formatInr(ewb.totals.tax)} />
          <KeyValue label="Total value" value={formatInr(ewb.totals.total)} strong />
        </Card>

        <Card>
          <SectionHead icon="truck" title="Transport" />
          <KeyValue label="Mode" value={ewb.transport.mode} />
          <KeyValue label="Vehicle" value={ewb.transport.vehicleNumber || 'Pending'} mono />
          <KeyValue label="Distance" value={`${ewb.transport.distanceKm} km`} />
          <KeyValue label="Transporter" value={ewb.transport.transporterName || '—'} />
          {ewb.transport.transporterId ? <KeyValue label="Transporter ID" value={ewb.transport.transporterId} /> : null}
          {ewb.transport.docNumber ? <KeyValue label="Transport doc" value={`${ewb.transport.docNumber} · ${ewb.transport.docDate ?? ''}`} /> : null}
        </Card>

        {status !== 'cancelled' ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <SectionHead icon="sliders" title="Bill actions" />
              <TextBlock size={12} color={colors.mutedForeground}>{credits.balance !== null ? `${credits.balance} credits` : ''}</TextBlock>
            </View>
            <ActionGrid>
              <ActionCard icon="truck" title="Part-B" detail={ewb.consolidatedInto ? `In consolidated bill ${ewb.consolidatedInto}` : canUpdateVehicle ? `Update vehicle · ${credits.costs.part_b} credits` : 'Not on an expired bill'} disabled={!canUpdateVehicle} busy={busy === 'Update vehicle'} onPress={() => void updateVehicle()} testID="ewb-partb" />
              <ActionCard icon="layers" title="Consolidate" detail={ewb.consolidatedInto ? 'Already consolidated' : `With other bills · ${credits.costs.consolidate} credits`} disabled={Boolean(ewb.consolidatedInto) || status === 'expired'} onPress={consolidate} testID="ewb-consolidate" />
              <ActionCard icon="clock" title="Extend" detail={canExtend ? `Window open · ${credits.costs.extend} credits` : `From ${formatDate(new Date(validUntil - 8 * HOUR).toISOString(), true)}`} disabled={!canExtend} busy={busy === 'Extend validity'} onPress={() => void extend()} testID="ewb-extend" />
              <ActionCard icon="refresh-cw" title="Refresh" detail={refreshing ? 'Checking…' : 'Reload status'} busy={refreshing} onPress={() => void refresh(true)} />
            </ActionGrid>
          </View>
        ) : null}

        <Card>
          <SectionHead icon="activity" title="History" />
          {[...ewb.history].reverse().map((item, index) => (
            <View key={`${item.at}${index}`} style={styles.event}>
              <View style={[styles.eventDot, { backgroundColor: index === 0 ? colors.primary : colors.input }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <TextBlock size={13} weight="semibold">{item.action}</TextBlock>
                <TextBlock size={12} color={colors.mutedForeground}>{item.detail}</TextBlock>
              </View>
              <TextBlock size={11} color={colors.mutedForeground}>{formatDate(item.at, true)}</TextBlock>
            </View>
          ))}
        </Card>

        <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center', lineHeight: 17 }}>
          Source: {ewb.verificationSource}{'\n'}Last verified {formatDate(ewb.lastVerifiedAt, true)} · Provider ID {ewb.providerBillId}
        </TextBlock>
      </ScrollView>
    </View>
  );
}

function SectionHead({ icon, title }: { icon: keyof typeof Feather.glyphMap; title: string }) {
  const colors = useColors();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Feather name={icon} size={16} color={colors.primary} /><TextBlock size={15} weight="semibold">{title}</TextBlock></View>;
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  hero: { gap: 10 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  trackLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  route: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  event: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  eventDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
});
