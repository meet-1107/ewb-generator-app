import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';
import { api, ApiError } from '@/lib/api';
import { formatDate, GST_STATUS_META, periodLabel, previousPeriod, relativeTime, type GstSnapshot } from '@/lib/domain';
import { Button, Card, Chip, ChipRow, Heading, KeyValue, Notice, Page, SelectField, Sheet, Skeleton, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';

const RETURNS: { type: GstSnapshot['returnType']; title: string; description: string }[] = [
  { type: 'GSTR-1', title: 'GSTR-1', description: 'Outward supplies (sales)' },
  { type: 'GSTR-2B', title: 'GSTR-2 / 2B', description: 'Inward supplies statement (auto-drafted)' },
  { type: 'GSTR-3B', title: 'GSTR-3B', description: 'Monthly summary & tax payment' },
];

export default function GstStatusScreen() {
  const colors = useColors();
  const store = useAppStore();
  const dialog = useDialog();
  const periods = useMemo(() => Array.from({ length: 12 }, (_, index) => previousPeriod(index + 1)), []);
  const [period, setPeriod] = useState(periods[0]!);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<GstSnapshot | null>(null);
  const gstin = store.activeGstin;
  const key = `${gstin}:${period}`;
  const cached = store.gstCache[key];
  const provider = store.config?.gstProvider;
  const registrations = store.business?.gstRegistrations ?? [];

  const load = useCallback(async () => {
    if (!gstin || !store.workspaceId) return;
    setLoading(true);
    try {
      const result = await api.gstStatus(gstin, period);
      if (result.snapshots.length) store.setGstCache(key, result.snapshots);
    } catch {
      // Cached data (or "Not checked") stays visible.
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin, period, key, store.workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    if (!gstin) return;
    setRefreshing(true);
    try {
      const result = await api.refreshGst(gstin, period);
      store.setGstCache(key, result.snapshots);
      dialog.toast(`Status checked for ${periodLabel(period)}`, 'success');
    } catch (error) {
      dialog.toast(error instanceof ApiError ? error.message : 'Could not reach the GST status provider.', error instanceof ApiError && error.status === 429 ? 'warning' : 'danger');
    } finally {
      setRefreshing(false);
    }
  };

  const summary = cached?.snapshots ?? [];
  const filedCount = summary.filter((item) => item.providerStatus === 'filed' && item.returnType !== 'GSTR-2B').length;

  return (
    <Page contentStyle={styles.page} onRefresh={refresh} refreshing={refreshing}>
      <Heading eyebrow="Compliance" title="GST status" subtitle="Read-only return status from your GST data provider." />
      {!provider && store.config ? <Notice tone="warning" title="GST status provider not configured" body="Status appears only after an authorized provider confirms it. We never ask for your GST portal password or OTP." /> : null}
      {provider?.sandbox ? <Notice tone="warning" title="Sandbox GST data" body="These statuses are test values from the sandbox provider, not your real filing record." /> : null}

      <Card>
        {registrations.length > 1 ? (
          <SelectField label="GST registration" value={gstin} placeholder="Choose GSTIN" options={registrations.map((item) => ({ value: item.gstin, label: item.gstin, detail: item.displayName }))} onSelect={(value) => void store.setActiveGstin(value)} />
        ) : (
          <KeyValue label="GSTIN" value={gstin || 'Not added'} mono />
        )}
        <View style={{ gap: 8 }}>
          <TextBlock size={13} weight="semibold">Return period</TextBlock>
          <ChipRow>
            {periods.map((item) => <Chip key={item} label={periodLabel(item)} selected={item === period} onPress={() => setPeriod(item)} />)}
          </ChipRow>
        </View>
      </Card>

      {cached ? (
        <View style={[styles.summary, { backgroundColor: colors.accent }]}>
          <Feather name={filedCount === 2 ? 'check-circle' : 'info'} size={18} color={colors.primary} />
          <TextBlock size={13} weight="medium" color={colors.accentForeground} style={{ flex: 1 }}>
            {filedCount === 2 ? `GSTR-1 and GSTR-3B are filed for ${periodLabel(period)}.` : `${2 - filedCount} of 2 returns not yet reported as filed for ${periodLabel(period)}.`}
          </TextBlock>
        </View>
      ) : null}

      <View style={{ gap: 11 }}>
        {RETURNS.map((item) => {
          const snapshot = summary.find((entry) => entry.returnType === item.type);
          const meta = snapshot ? GST_STATUS_META[snapshot.providerStatus] : null;
          return (
            <Card key={item.type} onPress={snapshot ? () => setDetail(snapshot) : undefined} accessibilityLabel={`${item.title}: ${meta?.label ?? 'Not checked'}`}>
              <View style={styles.returnTop}>
                <View style={{ flex: 1, gap: 3 }}>
                  <TextBlock size={17} weight="bold">{item.title}</TextBlock>
                  <TextBlock size={12} color={colors.mutedForeground}>{item.description}</TextBlock>
                </View>
                {loading && !snapshot ? <Skeleton width={80} height={24} radius={12} /> : <StatusPill label={meta?.label ?? 'Not checked'} tone={meta?.tone ?? 'neutral'} />}
              </View>
              <View style={{ gap: 7 }}>
                <KeyValue label="Period" value={periodLabel(period)} />
                {snapshot?.dueDate ? <KeyValue label="Due date" value={formatDate(snapshot.dueDate)} /> : null}
                {snapshot?.filedOn ? <KeyValue label={item.type === 'GSTR-2B' ? 'Generated on' : 'Filed on'} value={formatDate(snapshot.filedOn)} /> : null}
                <KeyValue label="Last checked" value={snapshot ? relativeTime(snapshot.checkedAt) : 'Not checked'} />
              </View>
            </Card>
          );
        })}
      </View>

      <Button title={refreshing ? 'Checking…' : 'Refresh status'} icon="refresh-cw" variant="outline" onPress={() => void refresh()} loading={refreshing} disabled={!gstin || !provider || store.online === false} />
      <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center', lineHeight: 17 }}>
        {cached ? `Source: ${cached.snapshots[0]?.source ?? 'provider'} · saved ${relativeTime(cached.fetchedAt)}` : 'Pull down or tap refresh to check status.'}{'\n'}This app shows status only. File returns on the GST portal or through your tax professional.
      </TextBlock>

      <Sheet visible={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `${detail.returnType} · ${periodLabel(detail.period)}` : ''} subtitle={detail?.gstin}>
        {detail ? (
          <View style={{ paddingHorizontal: 18, gap: 10, paddingBottom: 8 }}>
            <StatusPill label={GST_STATUS_META[detail.providerStatus].label} tone={GST_STATUS_META[detail.providerStatus].tone} />
            <KeyValue label="Provider return type" value={detail.returnType} />
            <KeyValue label="Provider status" value={detail.providerStatus.replace('_', ' ')} />
            {detail.dueDate ? <KeyValue label="Due date" value={formatDate(detail.dueDate)} /> : null}
            {detail.filedOn ? <KeyValue label="Filed / generated" value={formatDate(detail.filedOn)} /> : null}
            {detail.arn ? <KeyValue label="ARN" value={detail.arn} mono /> : null}
            <KeyValue label="Checked at" value={formatDate(detail.checkedAt, true)} />
            <KeyValue label="Source" value={detail.source} />
            {detail.returnType === 'GSTR-2B' ? <Notice title="About GSTR-2" body="GSTR-2 filing is suspended; providers report the auto-drafted GSTR-2B statement instead. We show the provider's exact return type." /> : null}
          </View>
        ) : null}
      </Sheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 16 },
  returnTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
});
