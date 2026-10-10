import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, EmptyState, IconButton, KeyValue, Notice, ScreenHeader, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
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
  const { id } = useLocalSearchParams<{ id: string }>();
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
    if (!(await credits.confirmSpend('extend', 'Extending validity'))) return;
    await runAction('Extend validity', { action: 'extend', reason: result.choice, remainingKm: Number(result.text) }, 'Validity extended');
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
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

        <View style={styles.docActions}>
          <DocAction icon="printer" label="Print" onPress={() => void docAction('print')} />
          <DocAction icon="download" label={Platform.OS === 'web' ? 'Save PDF' : 'Download'} onPress={() => void docAction('share')} />
          <DocAction icon="share" label="Share" onPress={() => void docAction('share')} />
          <DocAction icon="refresh-cw" label={refreshing ? 'Checking' : 'Refresh'} onPress={() => void refresh(true)} />
        </View>

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
          <Card>
            <SectionHead icon="sliders" title="Bill actions" />
            <ActionRow icon="truck" title="Update vehicle" detail={ewb.consolidatedInto ? `Moves under consolidated bill ${ewb.consolidatedInto}` : canUpdateVehicle ? `Part-B: change the vehicle carrying the goods${credits.costs.part_b ? ` · ${credits.costs.part_b} credits` : ''}` : 'Not available on an expired bill'} disabled={!canUpdateVehicle} busy={busy === 'Update vehicle'} onPress={() => void updateVehicle()} />
            <Divider />
            <ActionRow icon="clock" title="Extend validity" detail={canExtend ? 'Window open now' : `Available 8 h before expiry (${formatDate(new Date(validUntil - 8 * HOUR).toISOString(), true)})`} disabled={!canExtend} busy={busy === 'Extend validity'} onPress={() => void extend()} />
            <Divider />
            <ActionRow icon="x-octagon" title="Cancel bill" detail={canCancel ? `Allowed until ${formatDate(new Date(generatedAt + 24 * HOUR).toISOString(), true)}${credits.costs.cancel ? ` · ${credits.costs.cancel} credits` : ''}` : 'Cancellation window (24 h) has closed'} disabled={!canCancel} busy={busy === 'Cancel'} danger onPress={() => void cancel()} />
          </Card>
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

function DocAction({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.docAction, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.75 }]}>
      <View style={[styles.docIcon, { backgroundColor: colors.accent }]}><Feather name={icon} size={17} color={colors.primary} /></View>
      <TextBlock size={12} weight="semibold">{label}</TextBlock>
    </Pressable>
  );
}

function ActionRow({ icon, title, detail, onPress, disabled, busy, danger }: { icon: keyof typeof Feather.glyphMap; title: string; detail: string; onPress: () => void; disabled?: boolean; busy?: boolean; danger?: boolean }) {
  const colors = useColors();
  const fg = danger ? colors.dangerForeground : colors.primary;
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} style={({ pressed }) => [styles.actionRow, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
      <View style={[styles.docIcon, { backgroundColor: danger ? colors.dangerBackground : colors.accent }]}><Feather name={icon} size={16} color={fg} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <TextBlock size={14} weight="semibold" color={danger ? colors.dangerForeground : undefined}>{busy ? `${title}…` : title}</TextBlock>
        <TextBlock size={12} color={colors.mutedForeground}>{detail}</TextBlock>
      </View>
      <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  hero: { gap: 10 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  trackLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  docActions: { flexDirection: 'row', gap: 8 },
  docAction: { flex: 1, borderWidth: 1, borderRadius: 16, paddingVertical: 12, alignItems: 'center', gap: 7, minHeight: 76 },
  docIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  route: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  event: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  eventDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
});
