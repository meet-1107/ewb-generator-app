import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, Notice, ScreenHeader, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { EwbLoginGuide } from '@/components/EwbLoginGuide';
import { useColors } from '@/hooks/useColors';
import { useCredits } from '@/hooks/useCredits';
import { api, ApiError } from '@/lib/api';
import { formatInr, invoiceIssues, invoiceTotals, releasedInvoiceIds, toEwbInput, transportIssues, uid, type Invoice } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

type RowState =
  | { kind: 'waiting' }
  | { kind: 'working' }
  | { kind: 'done'; ewbId: string; ewbNumber: string }
  | { kind: 'failed'; message: string; uncertain?: boolean };

/**
 * Bulk e-way bills: the invoices chosen on the Invoices tab, generated one after the
 * other with the same checks, credits and duplicate protection as a single bill.
 */
export default function BulkEwbScreen() {
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const credits = useCredits();
  const provider = store.config?.ewbProvider ?? null;
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [missingLogins, setMissingLogins] = useState<string[]>([]);
  const [guide, setGuide] = useState(false);
  const stop = useRef(false);

  const released = useMemo(() => releasedInvoiceIds(store.invoices, store.ewbs), [store.invoices, store.ewbs]);
  const chosen = useMemo(() => {
    const wanted = String(ids ?? '').split(',').filter(Boolean);
    return wanted.map((id) => store.invoices.find((invoice) => invoice.id === id)).filter((invoice): invoice is Invoice => Boolean(invoice));
  }, [ids, store.invoices]);
  /** Details each invoice still needs before its e-way bill can be generated. */
  const problems = useMemo(() => Object.fromEntries(chosen.map((invoice) => [invoice.id, invoice.status === 'ewb_generated' ? [] : [...invoiceIssues(invoice, store.invoices, released), ...transportIssues(invoice)]])), [chosen, store.invoices, released]);

  const ready = chosen.filter((invoice) => invoice.status !== 'ewb_generated' && !problems[invoice.id]?.length && rows[invoice.id]?.kind !== 'done');
  const cost = ready.length * credits.costs.generate;
  const balance = credits.balance;
  const short = balance !== null && balance < cost;
  const doneCount = Object.values(rows).filter((row) => row.kind === 'done').length;

  // Portal API login for every seller GSTIN, checked again when returning from the login screen.
  useFocusEffect(useCallback(() => {
    if (!store.config?.ewbCredentialsRequired || !store.workspaceId) return setMissingLogins([]);
    let active = true;
    api.ewbCredentials().then((result) => {
      if (!active || !result.required) return;
      const saved = new Set(result.credentials.map((credential) => credential.gstin));
      setMissingLogins([...new Set(chosen.map((invoice) => invoice.sellerGstin.trim().toUpperCase()))].filter((gstin) => gstin && !saved.has(gstin)));
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [chosen, store.config?.ewbCredentialsRequired, store.workspaceId]));

  const setRow = (id: string, state: RowState) => setRows((current) => ({ ...current, [id]: state }));

  const generateAll = async () => {
    if (running || !ready.length) return;
    if (missingLogins.length) return setGuide(true);
    if (short) {
      const open = await dialog.confirm({ title: 'Not enough credits', message: `${ready.length} e-way bills use ${cost} credits. Your wallet has ${balance}.`, confirmLabel: 'Open wallet', cancelLabel: 'Not now', tone: 'warning', icon: 'credit-card' });
      if (open) router.push('/wallet');
      return;
    }
    const ok = await dialog.confirm({
      title: `Generate ${ready.length} e-way bill${ready.length === 1 ? '' : 's'}?`,
      message: `This uses ${cost} credits${balance !== null ? ` (balance ${balance} → ${balance - cost})` : ''}. Credits for any bill that fails are refunded automatically.`,
      confirmLabel: 'Generate all',
      icon: 'send',
    });
    if (!ok) return;
    setRunning(true);
    stop.current = false;
    for (const invoice of ready) {
      if (stop.current) break;
      setRow(invoice.id, { kind: 'working' });
      // Same key per invoice as the single flow, so a retry never makes a duplicate bill.
      const key = invoice.idempotencyKey ?? uid('ewbreq_');
      await store.saveInvoice({ ...invoice, status: 'ready', ewbRequired: true, unsaved: false, idempotencyKey: key, updatedAt: new Date().toISOString() });
      try {
        const result = await api.generateEwb(key, toEwbInput(invoice));
        store.upsertEwb(result.ewb);
        if (result.balance !== undefined) store.setWalletBalance(result.balance);
        setRow(invoice.id, { kind: 'done', ewbId: result.ewb.id, ewbNumber: result.ewb.ewbNumber });
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        if (apiError?.code === 'duplicate' && apiError.body.ewb) {
          const existing = apiError.body.ewb as { id: string; ewbNumber: string };
          store.upsertEwb(apiError.body.ewb as never);
          setRow(invoice.id, { kind: 'done', ewbId: existing.id, ewbNumber: existing.ewbNumber });
          continue;
        }
        const uncertain = !apiError || apiError.status === 0 || apiError.status >= 500;
        setRow(invoice.id, { kind: 'failed', uncertain, message: uncertain ? 'No answer from the portal. Open the invoice later and check; trying again never makes a duplicate.' : apiError.message });
        // Nothing after this can succeed: stop and say why.
        if (apiError?.code === 'insufficient_credits' || apiError?.code === 'credentials_missing' || apiError?.code === 'provider_not_configured') {
          stop.current = true;
          if (apiError.code === 'credentials_missing') setGuide(true);
        }
      }
    }
    setRunning(false);
    void store.refreshWallet();
  };

  if (!chosen.length) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Bulk e-way bills" />
        <View style={{ padding: 20 }}><Notice tone="warning" title="No invoices chosen" body="Go back to Invoices, tap Select and choose the invoices." /></View>
      </View>
    );
  }

  const finished = !running && doneCount > 0 && ready.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Bulk e-way bills" subtitle={`${chosen.length} invoice${chosen.length === 1 ? '' : 's'} selected`} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 150 }]}>
        {provider?.sandbox ? <Notice tone="warning" title="Sandbox provider — test only" body="These bill numbers are not valid for moving goods." /> : null}
        {!provider ? <Notice tone="warning" title="EWB provider setup required" body="Generation is switched off until a provider is connected." /> : null}
        {missingLogins.length ? (
          <Notice tone="warning" title="E-way bill portal login needed" body={`Add the API login for ${missingLogins.join(', ')} first.`} action="Show me how" onAction={() => setGuide(true)} />
        ) : null}
        {short && ready.length ? <Notice tone="warning" title="Not enough credits" body={`${ready.length} bills need ${cost} credits; your wallet has ${balance}.`} action="Add credits" onAction={() => router.push('/wallet')} /> : null}

        <Card style={styles.summary}>
          <View style={{ flex: 1 }}>
            <TextBlock size={12} color={colors.mutedForeground}>READY TO GENERATE</TextBlock>
            <TextBlock size={24} weight="bold">{ready.length}</TextBlock>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <TextBlock size={12} color={colors.mutedForeground}>CREDITS</TextBlock>
            <TextBlock size={24} weight="bold" color={colors.primary}>{cost}</TextBlock>
          </View>
        </Card>

        <Card style={{ padding: 0, gap: 0 }}>
          {chosen.map((invoice, index) => {
            const row = rows[invoice.id];
            const issues = problems[invoice.id] ?? [];
            const already = invoice.status === 'ewb_generated' && row?.kind !== 'done';
            return (
              <React.Fragment key={invoice.id}>
                {index ? <Divider /> : null}
                <View style={styles.row}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <TextBlock size={14} weight="semibold" numberOfLines={1}>{invoice.invoiceNumber || 'No number'} · {invoice.buyerName || 'No buyer'}</TextBlock>
                    <TextBlock size={12} color={colors.mutedForeground}>{formatInr(invoiceTotals(invoice).total)}</TextBlock>
                    {row?.kind === 'done' ? (
                      <Pressable onPress={() => router.push(`/ewb/${row.ewbId}`)} accessibilityRole="link" hitSlop={6}><TextBlock size={13} weight="semibold" color={colors.primary}>EWB {row.ewbNumber} →</TextBlock></Pressable>
                    ) : row?.kind === 'failed' ? (
                      <TextBlock size={12} color={colors.dangerForeground}>{row.message}</TextBlock>
                    ) : already ? (
                      <TextBlock size={12} color={colors.mutedForeground}>Already has e-way bill {invoice.ewbNumber}</TextBlock>
                    ) : issues.length ? (
                      <TextBlock size={12} color={colors.dangerForeground}>{issues[0]!.message}{issues.length > 1 ? ` (+${issues.length - 1} more)` : ''}</TextBlock>
                    ) : null}
                  </View>
                  {row?.kind === 'working' ? <ActivityIndicator color={colors.primary} />
                    : row?.kind === 'done' ? <StatusPill label="Generated" tone="green" icon="check" />
                    : row?.kind === 'failed' ? <Button title="Open" size="sm" variant="outline" onPress={() => router.push(`/invoice/${invoice.id}`)} />
                    : already ? <StatusPill label="Done" tone="neutral" />
                    : issues.length ? <Button title="Fix" size="sm" variant="outline" onPress={() => router.push(`/invoice/${invoice.id}`)} />
                    : <StatusPill label="Ready" tone="blue" />}
                </View>
              </React.Fragment>
            );
          })}
        </Card>
        <TextBlock size={11} color={colors.mutedForeground}>Bills are generated one after the other. Invoices with missing details are skipped; tap Fix, then come back.</TextBlock>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 10 }]}>
        {finished ? (
          <Button title={`Done · ${doneCount} generated`} icon="check" onPress={() => router.replace('/(tabs)/ewbs')} />
        ) : running ? (
          <Button title="Stop after this bill" icon="pause" variant="outline" onPress={() => { stop.current = true; }} />
        ) : (
          <Button
            title={missingLogins.length ? 'Set up e-way bill portal login' : `Generate ${ready.length} e-way bill${ready.length === 1 ? '' : 's'} · ${cost} credits`}
            icon={missingLogins.length ? 'key' : 'send'}
            onPress={() => void generateAll()}
            disabled={!provider || (!ready.length && !missingLogins.length) || store.online === false}
            testID="bulk-generate"
          />
        )}
        {running ? <View style={styles.progress}><Feather name="loader" size={12} color={colors.mutedForeground} /><TextBlock size={12} color={colors.mutedForeground}>Generating… keep the app open</TextBlock></View> : null}
      </View>
      <EwbLoginGuide visible={guide} gstin={missingLogins[0] ?? ''} onClose={() => setGuide(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: 1, padding: 12, gap: 8 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
});
