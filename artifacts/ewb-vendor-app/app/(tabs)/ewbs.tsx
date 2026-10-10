import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAppStore, useScopedRecords } from '@/state/app-store';
import { ewbStatusMeta, formatDate, formatInr, liveEwbStatus, relativeTime, type EwbRecord } from '@/lib/domain';
import { Button, Card, Chip, ChipRow, EmptyState, Field, Heading, Notice, Page, SearchBar, SectionTitle, SelectSheet, Sheet, Skeleton, StatusPill, TextBlock } from '@/components/AppUI';
import { ActionCard, ActionGrid } from '@/components/ActionCard';
import { AccountButton } from '@/components/Brand';
import { useCredits } from '@/hooks/useCredits';
import { useDialog } from '@/components/Dialog';

type Filter = 'all' | 'active' | 'expired' | 'cancelled' | 'check';
const PAGE = 25;
const tabs: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Expired', value: 'expired' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Verification needed', value: 'check' },
];

function needsCheck(ewb: EwbRecord) {
  const status = liveEwbStatus(ewb);
  return status === 'part_b_pending' || (status === 'active' && Date.now() - Date.parse(ewb.lastVerifiedAt) > 24 * 3_600_000);
}

export default function EwbRegisterScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ status?: string; period?: string }>();
  const store = useAppStore();
  const dialog = useDialog();
  const { ewbs } = useScopedRecords();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [period, setPeriod] = useState('');
  const [transporter, setTransporter] = useState('');
  const [sheet, setSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [picker, setPicker] = useState<'part_b' | 'cancel' | null>(null);
  const credits = useCredits();
  const partBBills = useMemo(() => ewbs.filter((ewb) => !ewb.consolidatedInto && ['active', 'part_b_pending'].includes(liveEwbStatus(ewb))), [ewbs]);
  const cancellable = useMemo(() => ewbs.filter((ewb) => liveEwbStatus(ewb) !== 'cancelled' && Date.now() - Date.parse(ewb.generatedAt) <= 24 * 3_600_000), [ewbs]);

  useEffect(() => {
    if (params.status && tabs.some((tab) => tab.value === params.status)) setFilter(params.status as Filter);
    setPeriod(params.period && /^\d{4}-\d{2}$/.test(params.period) ? params.period : '');
  }, [params.status, params.period]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: ewbs.length, active: 0, expired: 0, cancelled: 0, check: 0 };
    for (const ewb of ewbs) {
      const status = liveEwbStatus(ewb);
      if (status === 'active' || status === 'part_b_pending') result.active += 1;
      if (status === 'expired') result.expired += 1;
      if (status === 'cancelled') result.cancelled += 1;
      if (needsCheck(ewb)) result.check += 1;
    }
    return result;
  }, [ewbs]);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase().replace(/\s/g, '');
    return ewbs.filter((ewb) => {
      const status = liveEwbStatus(ewb);
      if (filter === 'active' && status !== 'active' && status !== 'part_b_pending') return false;
      if (filter === 'expired' && status !== 'expired') return false;
      if (filter === 'cancelled' && status !== 'cancelled') return false;
      if (filter === 'check' && !needsCheck(ewb)) return false;
      if (period && !ewb.generatedAt.startsWith(period)) return false;
      if (transporter && !ewb.transport.transporterName.toLowerCase().includes(transporter.toLowerCase())) return false;
      if (!clean) return true;
      return [ewb.ewbNumber, ewb.invoiceNumber, ewb.buyerName, ewb.buyerGstin, ewb.transport.vehicleNumber].some((value) => value.toLowerCase().replace(/\s/g, '').includes(clean));
    });
  }, [ewbs, filter, period, query, transporter]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await store.refreshEwbs();
    } catch (error) {
      dialog.toast((error as Error).message, 'danger');
    } finally {
      setRefreshing(false);
    }
  };

  const loading = store.ewbsFetchedAt === null && store.online !== false && !ewbs.length;

  return (
    <Page contentStyle={styles.page} onRefresh={refresh} refreshing={refreshing}>
      <Heading eyebrow="Movement" title="E-way bills" subtitle={store.ewbsFetchedAt ? `${ewbs.length} bills · updated ${relativeTime(store.ewbsFetchedAt)}` : 'Bills confirmed by your provider appear here.'} right={<AccountButton />} />
      <ActionGrid>
        <ActionCard icon="plus-circle" title="New e-way bill" detail={`From an invoice · ${credits.costs.generate} credits`} onPress={() => router.push({ pathname: '/(tabs)/invoices', params: { for: 'ewb' } })} testID="quick-new" />
        <ActionCard icon="truck" title="Part-B" detail={`Update vehicle · ${credits.costs.part_b} credits`} disabled={!partBBills.length} onPress={() => setPicker('part_b')} testID="quick-partb" />
        <ActionCard icon="layers" title="Consolidate" detail={`Several bills, one vehicle · ${credits.costs.consolidate} credits`} disabled={!partBBills.length} onPress={() => router.push('/ewb/consolidate')} testID="open-consolidate" />
        <ActionCard icon="x-octagon" title="Cancel" danger detail={`Within 24 h · ${credits.costs.cancel} credits`} disabled={!cancellable.length} onPress={() => setPicker('cancel')} testID="quick-cancel" />
      </ActionGrid>
      <SelectSheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'cancel' ? 'Choose a bill to cancel' : 'Choose a bill for Part-B'}
        options={(picker === 'cancel' ? cancellable : partBBills).map((ewb) => ({ value: ewb.id, label: ewb.ewbNumber, detail: `${ewb.invoiceNumber} · ${ewb.buyerName} · ${ewb.transport.vehicleNumber || 'no vehicle'}` }))}
        onSelect={(id) => { const next = picker; setPicker(null); router.push({ pathname: '/ewb/[id]', params: { id, action: next ?? '' } }); }}
        emptyText="No bills available for this action."
      />
      {store.config?.ewbProvider?.sandbox ? <Notice title="Sandbox provider" body="These bills are test records and are not valid for moving goods." tone="warning" /> : null}
      {!store.config?.ewbProvider && store.online !== false && store.config ? <Notice title="EWB provider setup required" body="Connect an authorized provider to generate bills." tone="warning" /> : null}
      {store.online === false ? <Notice title="Offline — showing saved copy" body={store.ewbsFetchedAt ? `Last updated ${formatDate(store.ewbsFetchedAt, true)}. Status may have changed since.` : 'Nothing has been downloaded on this device yet.'} /> : null}
      <SearchBar
        value={query}
        onChangeText={(value) => { setQuery(value); setLimit(PAGE); }}
        placeholder="EWB, invoice, buyer or vehicle"
        right={<Pressable onPress={() => setSheet(true)} hitSlop={10} style={{ paddingLeft: 6 }} accessibilityRole="button" accessibilityLabel="More filters"><Feather name="sliders" size={18} color={period || transporter ? colors.primary : colors.mutedForeground} /></Pressable>}
      />
      <ChipRow>
        {tabs.map((tab) => <Chip key={tab.value} label={tab.label} count={counts[tab.value]} selected={filter === tab.value} onPress={() => { setFilter(tab.value); setLimit(PAGE); }} />)}
        {period ? <Chip label={`Month ${period}`} icon="x" selected={false} onPress={() => setPeriod('')} /> : null}
      </ChipRow>

      <SectionTitle title={filter === 'all' && !query ? 'All bills' : 'Matching bills'} count={filtered.length} />
      {loading ? (
        <View style={{ gap: 10 }}>{[0, 1, 2].map((index) => <Card key={index}><Skeleton width="50%" /><Skeleton width="80%" height={12} /><Skeleton width="35%" height={12} /></Card>)}</View>
      ) : filtered.length ? (
        <View style={{ gap: 10 }}>
          {filtered.slice(0, limit).map((ewb) => <EwbRow key={ewb.id} ewb={ewb} />)}
          {filtered.length > limit ? <Button title={`Show more (${filtered.length - limit})`} variant="outline" onPress={() => setLimit((current) => current + PAGE)} /> : null}
        </View>
      ) : (
        <Card>
          <EmptyState
            icon={query || filter !== 'all' ? 'search' : 'truck'}
            title={query || filter !== 'all' ? 'No matching bills' : 'No e-way bills yet'}
            body={query || filter !== 'all' ? 'Try another search or status.' : 'Open a ready invoice and choose “Review EWB”. Bills show here once the provider confirms them.'}
            action={!query && filter === 'all' ? <Button title="Go to invoices" icon="file-text" variant="outline" onPress={() => router.push('/(tabs)/invoices')} /> : undefined}
          />
        </Card>
      )}

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Filter e-way bills" footer={<View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Clear" variant="outline" onPress={() => { setPeriod(''); setTransporter(''); }} style={{ flex: 1 }} />
        <Button title="Apply" onPress={() => setSheet(false)} style={{ flex: 1 }} />
      </View>}>
        <View style={{ paddingHorizontal: 18, gap: 12 }}>
          <Field label="Generated in month" value={period} onChangeText={setPeriod} placeholder="YYYY-MM" maxLength={7} />
          <Field label="Transporter" value={transporter} onChangeText={setTransporter} placeholder="Transporter name" />
          <TextBlock size={11} color={colors.mutedForeground}>Search also matches EWB number, invoice number, buyer and vehicle.</TextBlock>
        </View>
      </Sheet>
    </Page>
  );
}

function EwbRow({ ewb }: { ewb: EwbRecord }) {
  const colors = useColors();
  const status = liveEwbStatus(ewb);
  const meta = ewbStatusMeta(status);
  const expiresIn = Date.parse(ewb.validUntil) - Date.now();
  const soon = (status === 'active' || status === 'part_b_pending') && expiresIn < 8 * 3_600_000;
  return (
    <Card onPress={() => router.push(`/ewb/${ewb.id}`)} style={styles.row} accessibilityLabel={`E-way bill ${ewb.ewbNumber} for ${ewb.buyerName}, ${meta.label}`}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1, gap: 3 }}>
          <TextBlock size={16} weight="bold" style={{ letterSpacing: 1 }}>{ewb.ewbNumber.replace(/(\d{4})(?=\d)/g, '$1 ')}</TextBlock>
          <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{ewb.invoiceNumber} · {ewb.buyerName}</TextBlock>
        </View>
        <StatusPill label={meta.label} tone={meta.tone} />
      </View>
      <View style={[styles.rowMeta, { borderTopColor: colors.border }]}>
        <Meta icon="calendar" label="Generated" value={formatDate(ewb.generatedAt)} />
        <Meta icon="clock" label={status === 'expired' ? 'Expired' : 'Valid until'} value={formatDate(ewb.validUntil, true)} danger={soon} />
        <Meta icon="truck" label="Vehicle" value={ewb.transport.vehicleNumber || 'Pending'} />
      </View>
      <View style={styles.rowFoot}>
        <TextBlock size={11} color={colors.mutedForeground}>Verified {relativeTime(ewb.lastVerifiedAt)} · {ewb.provider === 'sandbox' ? 'Sandbox' : ewb.provider}</TextBlock>
        <TextBlock size={13} weight="semibold">{formatInr(ewb.totals.total)}</TextBlock>
      </View>
    </Card>
  );
}

function Meta({ icon, label, value, danger }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; danger?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Feather name={icon} size={11} color={danger ? colors.dangerForeground : colors.mutedForeground} /><TextBlock size={10} color={danger ? colors.dangerForeground : colors.mutedForeground}>{label}</TextBlock></View>
      <TextBlock size={12} weight="semibold" color={danger ? colors.dangerForeground : undefined} numberOfLines={1}>{value}</TextBlock>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  row: { padding: 14, gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowMeta: { flexDirection: 'row', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 11 },
  rowFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
