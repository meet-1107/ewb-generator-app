import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Checkbox, Divider, KeyValue, Notice, ProgressSteps, ScreenHeader, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { useCredits } from '@/hooks/useCredits';
import { api, ApiError, type ProviderIssue } from '@/lib/api';
import { formatDate, formatInr, invoiceTotals, toEwbInput, uid, type EwbRecord } from '@/lib/domain';
import { ewbHtml, printHtml } from '@/lib/documents';
import { usePdfActions } from '@/hooks/usePdfActions';
import { ActionCard, ActionGrid } from '@/components/ActionCard';
import { EwbPreview } from '@/components/EwbPreview';
import { useAppStore } from '@/state/app-store';

type Phase = 'checking' | 'review' | 'submitting' | 'generated' | 'rejected' | 'uncertain';

const sectionLabel: Record<ProviderIssue['section'], string> = { seller: 'Seller', buyer: 'Receiver', invoice: 'Invoice', items: 'Products', transport: 'Transport' };

export default function EwbReviewScreen() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const credits = useCredits();
  const invoice = store.invoices.find((item) => item.id === invoiceId);
  const [phase, setPhase] = useState<Phase>('checking');
  const [issues, setIssues] = useState<ProviderIssue[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [problem, setProblem] = useState<{ title: string; body: string; reference?: string } | null>(null);
  const [generated, setGenerated] = useState<EwbRecord | null>(null);
  const inFlight = useRef(false);
  const requestKey = useRef<string | null>(null);
  const input = useMemo(() => (invoice ? toEwbInput(invoice) : null), [invoice]);
  const provider = store.config?.ewbProvider ?? null;

  const check = useCallback(async () => {
    if (!input) return;
    setPhase('checking');
    setProblem(null);
    try {
      const result = await api.validateEwb(input);
      setIssues(result.issues);
      setWarnings(result.warnings);
      setPhase('review');
    } catch (error) {
      setIssues([]);
      setPhase('review');
      if (error instanceof ApiError && error.code === 'provider_not_configured') setProblem({ title: 'EWB provider setup required', body: 'Generation is disabled until an authorized provider is connected. You can keep preparing drafts.' });
      else setProblem({ title: 'Could not check with the provider', body: error instanceof ApiError ? error.message : 'Check your connection and try again.' });
    }
  }, [input]);

  useEffect(() => {
    if (invoice?.status === 'ewb_generated' && phase !== 'generated') {
      router.replace(`/ewb/${invoice.ewbId}`);
      return;
    }
    if (phase === 'checking') void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!invoice || !input) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Review e-way bill" />
        <View style={{ padding: 20 }}><Notice tone="warning" title="Invoice not found" body="It may have been deleted. Go back to your invoices." /></View>
      </View>
    );
  }

  const totals = invoiceTotals(invoice);

  const submit = async (confirmedRetry = false) => {
    // Taken before any dialog: a second tap would otherwise queue a second confirm and a second request.
    if (inFlight.current) return;
    inFlight.current = true;
    if (phase === 'uncertain' && !confirmedRetry) {
      const ok = await dialog.confirm({ title: 'Try submitting again?', message: 'We will reuse the same request ID, so the provider returns the existing bill instead of creating a duplicate if the first attempt went through.', confirmLabel: 'Submit again', icon: 'refresh-cw' });
      if (!ok) { inFlight.current = false; return; }
    } else if (!(await credits.confirmSpend('generate', 'Generating this e-way bill'))) {
      inFlight.current = false;
      return;
    }
    setPhase('submitting');
    setProblem(null);
    // A stable key per invoice version makes retries safe; kept in a ref so every tap uses the same one.
    const key = requestKey.current ?? invoice.idempotencyKey ?? uid('ewbreq_');
    requestKey.current = key;
    if (!invoice.idempotencyKey) await store.saveInvoice({ ...invoice, idempotencyKey: key });
    try {
      const result = await api.generateEwb(key, input);
      store.upsertEwb(result.ewb);
      setGenerated(result.ewb);
      setPhase('generated');
      dialog.toast(`E-way bill ${result.ewb.ewbNumber} generated${result.replay ? '' : ` · ${credits.costs.generate} credits used`}`, 'success');
      store.setWalletBalance(result.balance);
      void store.refreshWallet();
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      if (!apiError || apiError.status === 0 || apiError.status >= 500) {
        setPhase('uncertain');
        setProblem({ title: 'Waiting for provider confirmation', body: 'We could not confirm whether the bill was created. Check the status before trying again — retries never create a duplicate.' });
      } else if (apiError.code === 'rejected') {
        setIssues((apiError.body.issues as ProviderIssue[]) ?? []);
        setPhase('rejected');
        setProblem({ title: 'The provider rejected some details', body: apiError.message, reference: apiError.body.reference as string | undefined });
      } else if (apiError.code === 'duplicate' && apiError.body.ewb) {
        const existing = apiError.body.ewb as EwbRecord;
        store.upsertEwb(existing);
        setPhase('review');
        const open = await dialog.confirm({ title: 'Bill already exists', message: apiError.message, confirmLabel: 'Open bill', cancelLabel: 'Close', icon: 'copy' });
        if (open) router.replace(`/ewb/${existing.id}`);
      } else if (apiError.code === 'insufficient_credits' || apiError.code === 'credentials_missing') {
        setPhase('review');
        await credits.handleError(apiError);
      } else if (apiError.code === 'pending') {
        setPhase('uncertain');
        setProblem({ title: 'Already submitting', body: apiError.message });
      } else {
        setPhase('review');
        setProblem({ title: 'Could not generate', body: apiError.message });
      }
    } finally {
      inFlight.current = false;
    }
  };

  const checkStatus = async () => {
    setPhase('checking');
    try {
      const list = await api.listEwbs();
      const found = list.ewbs.find((ewb) => ewb.invoiceId === invoice.id && ewb.status !== 'cancelled');
      if (found) {
        store.upsertEwb(found);
        setGenerated(found);
        setPhase('generated');
        return;
      }
      setPhase('uncertain');
      setProblem({ title: 'Not found yet', body: 'No bill is recorded for this invoice yet; the provider may still be processing. Submitting again is safe: it reuses the same request and never creates or charges a second bill.' });
    } catch {
      setPhase('uncertain');
      setProblem({ title: 'Still offline', body: 'Reconnect, then check the status again.' });
    }
  };

  const editInvoice = () => (router.canGoBack() ? router.back() : router.replace(`/invoice/${invoice.id}`));

  if (phase === 'generated' && generated) return <GeneratedView ewb={generated} sandbox={Boolean(provider?.sandbox)} />;

  const blocking = issues.length > 0 || !provider || store.online === false;
  const busy = phase === 'checking' || phase === 'submitting';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Review e-way bill" subtitle={`${invoice.invoiceNumber} · ${invoice.buyerName}`} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 140 }]}>
        <ProgressSteps steps={['Invoice', 'Review EWB', 'Generated']} current={1} />
        <Notice
          tone="warning"
          title={provider?.sandbox ? 'Sandbox provider — test only' : 'This creates a government record'}
          body={provider?.sandbox
            ? 'This request goes to a test provider. The bill number it returns is not valid for moving goods.'
            : `Submitting sends these details to ${provider?.label ?? 'your EWB provider'} and may create a record on the e-way bill portal.`}
        />
        {store.online === false ? <Notice tone="danger" title="You're offline" body="Connect to the internet to generate. Submissions are never queued for later." /> : null}
        {problem ? <Notice tone={phase === 'uncertain' ? 'warning' : 'danger'} title={problem.title} body={`${problem.body}${problem.reference ? ` Reference: ${problem.reference}` : ''}`} /> : null}

        {phase === 'checking' ? (
          <Card style={styles.checking}><ActivityIndicator color={colors.primary} /><TextBlock size={14} color={colors.mutedForeground}>Checking details with the provider…</TextBlock></Card>
        ) : issues.length ? (
          <Card style={{ borderColor: colors.dangerBorder }}>
            <View style={styles.cardHead}><Feather name="alert-octagon" size={17} color={colors.dangerForeground} /><TextBlock size={15} weight="semibold">{issues.length} thing{issues.length === 1 ? '' : 's'} to fix</TextBlock></View>
            {issues.map((issue) => (
              <Pressable key={`${issue.field}${issue.message}`} onPress={editInvoice} style={styles.issue} accessibilityRole="button" accessibilityLabel={`${issue.message}. Edit ${sectionLabel[issue.section]}`}>
                <View style={[styles.issueDot, { backgroundColor: colors.destructive }]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <TextBlock size={11} weight="semibold" color={colors.mutedForeground}>{sectionLabel[issue.section].toUpperCase()}</TextBlock>
                  <TextBlock size={13}>{issue.message}</TextBlock>
                </View>
                <TextBlock size={12} weight="semibold" color={colors.primary}>Edit</TextBlock>
              </Pressable>
            ))}
          </Card>
        ) : !problem ? (
          <Notice tone="success" title="All provider checks passed" body="Review the summary below, then confirm." />
        ) : null}
        {warnings.map((warning) => <Notice key={warning} tone="info" title="Note" body={warning} />)}

        <SummaryCard title="Parties" icon="users" onEdit={editInvoice}>
          <KeyValue label="From" value={`${invoice.sellerName}\n${invoice.sellerGstin}`} />
          <KeyValue label="Dispatch" value={`${invoice.sellerState} ${invoice.sellerPincode}`} />
          <Divider />
          <KeyValue label="To" value={`${invoice.buyerName}\n${invoice.buyerGstin || 'URP (unregistered)'}`} />
          <KeyValue label="Deliver to" value={`${invoice.buyerState} ${invoice.buyerPincode}`} />
        </SummaryCard>
        <SummaryCard title="Document & value" icon="file-text" onEdit={editInvoice}>
          <KeyValue label={invoice.documentType} value={`${invoice.invoiceNumber} · ${formatDate(invoice.invoiceDate)}`} />
          <KeyValue label="Items" value={`${input.lines.length} (${input.lines.map((line) => line.hsn).filter(Boolean).slice(0, 3).join(', ')})`} />
          <KeyValue label="Taxable value" value={formatInr(totals.taxable)} />
          <KeyValue label={invoice.supplyType === 'intra' ? 'CGST + SGST' : 'IGST'} value={formatInr(totals.tax)} />
          <KeyValue label="Total value" value={formatInr(totals.total)} strong />
        </SummaryCard>
        <SummaryCard title="Transport" icon="truck" onEdit={editInvoice}>
          <KeyValue label="Mode" value={`${invoice.transportMode}${invoice.vehicleType === 'odc' ? ' · Over-dimensional' : ''}`} />
          <KeyValue label={invoice.transportMode === 'Road' ? 'Vehicle' : 'Transport doc'} value={invoice.transportMode === 'Road' ? invoice.vehicleNumber || 'By transporter' : `${invoice.transportDocNo} · ${invoice.transportDocDate}`} mono />
          <KeyValue label="Distance" value={invoice.distanceKm ? `${invoice.distanceKm} km` : '—'} />
          <KeyValue label="Expected validity" value={invoice.distanceKm ? `${Math.max(1, Math.ceil(Number(invoice.distanceKm) / (invoice.vehicleType === 'odc' ? 20 : 200)))} day(s)` : '—'} />
          <KeyValue label="Transporter" value={invoice.transporterName || '—'} />
        </SummaryCard>

        <Card>
          <Checkbox checked={acknowledged} onToggle={() => setAcknowledged((current) => !current)} label="I reviewed these invoice and transport details." testID="ack" />
        </Card>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: (Platform.OS === 'web' ? 12 : insets.bottom) + 10 }]}>
        {phase === 'uncertain' ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Check status" icon="refresh-cw" variant="outline" onPress={() => void checkStatus()} style={{ flex: 1 }} />
            <Button title="Submit again" onPress={() => void submit()} style={{ flex: 1 }} disabled={store.online === false} />
          </View>
        ) : (
          <>
            <Button
              title={!provider ? 'EWB provider setup required' : phase === 'submitting' ? 'Submitting…' : phase === 'checking' ? 'Checking…' : `Generate e-way bill · ${credits.costs.generate} credits`}
              icon={!provider ? 'lock' : 'send'}
              onPress={() => void submit()}
              loading={busy}
              disabled={!acknowledged || blocking || busy}
              testID="generate-ewb"
              accessibilityHint={!acknowledged ? 'Tick the review confirmation first' : undefined}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Edit invoice" variant="ghost" size="sm" onPress={editInvoice} style={{ flex: 1 }} />
              <Button title="Re-check" variant="ghost" size="sm" icon="refresh-cw" onPress={() => void check()} style={{ flex: 1 }} disabled={busy} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function SummaryCard({ title, icon, onEdit, children }: { title: string; icon: keyof typeof Feather.glyphMap; onEdit: () => void; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Card>
      <View style={styles.cardHead}>
        <Feather name={icon} size={16} color={colors.primary} />
        <TextBlock size={15} weight="semibold" style={{ flex: 1 }}>{title}</TextBlock>
        <Pressable onPress={onEdit} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Edit ${title}`}><TextBlock size={13} weight="semibold" color={colors.primary}>Edit</TextBlock></Pressable>
      </View>
      {children}
    </Card>
  );
}

function GeneratedView({ ewb, sandbox }: { ewb: EwbRecord; sandbox: boolean }) {
  const colors = useColors();
  const invoice = useAppStore().invoices.find((item) => item.id === ewb.invoiceId);
  const insets = useSafeAreaInsets();
  const dialog = useDialog();
  const pdf = usePdfActions();
  const [previewOpen, setPreviewOpen] = useState(false);
  const scale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [scale]);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [pulse]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: (Platform.OS === 'web' ? 30 : insets.top) + 20, paddingBottom: insets.bottom + 20, paddingHorizontal: 22, gap: 16 }}>
      <ProgressSteps steps={['Invoice', 'Review EWB', 'Generated']} current={2} />
      <View style={styles.success}>
        <Animated.View style={[styles.successRing, { borderColor: colors.successBackground, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }] }]} />
        <Animated.View style={[styles.successIcon, { backgroundColor: colors.primary, transform: [{ scale }] }]}><Feather name="check" size={38} color={colors.primaryForeground} /></Animated.View>
        <TextBlock size={13} weight="semibold" color={colors.mutedForeground}>E-WAY BILL GENERATED</TextBlock>
        <TextBlock size={30} weight="bold" style={{ letterSpacing: 2 }} selectable>{ewb.ewbNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}</TextBlock>
        <StatusPill label="Active" tone="green" />
        <TextBlock size={13} color={colors.mutedForeground} style={{ textAlign: 'center', lineHeight: 19 }}>Valid until {formatDate(ewb.validUntil, true)} · {ewb.validityDays} day{ewb.validityDays === 1 ? '' : 's'}</TextBlock>
      </View>
      {sandbox ? <Notice tone="warning" title="Sandbox bill" body="This number came from the test provider and cannot be used to move goods." /> : null}
      <View style={{ marginTop: 'auto', gap: 10 }}>
        <Button title="View e-way bill" icon="eye" onPress={() => router.replace(`/ewb/${ewb.id}`)} testID="view-generated" />
        <ActionGrid>
          <ActionCard icon="download" title="Download" detail="Save PDF to your phone" onPress={() => void pdf.download(ewbHtml(ewb, sandbox, invoice), `EWB ${ewb.ewbNumber}`)} />
          {Platform.OS !== 'web' ? <ActionCard icon="share-2" title="Share" detail="WhatsApp, email and more" onPress={() => void pdf.share(ewbHtml(ewb, sandbox, invoice), `EWB ${ewb.ewbNumber}`)} /> : null}
          <ActionCard icon="printer" title="Print" detail="Print a paper copy" onPress={() => void printHtml(ewbHtml(ewb, sandbox, invoice)).catch((error: Error) => dialog.toast(error.message, 'danger'))} />
          <ActionCard icon="eye" title="Preview" detail="See the bill as it prints" onPress={() => setPreviewOpen(true)} />
          <ActionCard icon="x-octagon" title="Cancel" danger detail="Within 24 h · opens the bill" onPress={() => router.replace({ pathname: '/ewb/[id]', params: { id: ewb.id, action: 'cancel' } })} />
        </ActionGrid>
        <EwbPreview ewb={ewb} visible={previewOpen} onClose={() => setPreviewOpen(false)} sandbox={sandbox} />
        <Button title="Back to dashboard" variant="ghost" onPress={() => router.replace('/(tabs)')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  checking: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  issue: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 4 },
  issueDot: { width: 7, height: 7, borderRadius: 4 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, gap: 4 },
  success: { alignItems: 'center', gap: 10, paddingTop: 24 },
  successRing: { position: 'absolute', top: 24, width: 92, height: 92, borderRadius: 46, borderWidth: 10 },
  successIcon: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
});
