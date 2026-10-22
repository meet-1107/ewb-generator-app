import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { useAppStore, useScopedRecords } from '@/state/app-store';
import {
  ewbStatusMeta,
  financialYear,
  formatDate,
  formatInr,
  invoiceTotals,
  istDate,
  liveEwbStatus,
  relativeTime,
  today,
} from '@/lib/domain';
import { Card, Notice, Page, SectionTitle, StatCard, StatusPill, TextBlock, SelectSheet } from '@/components/AppUI';
import InvoiceCard from '@/components/InvoiceCard';
import { AccountButton, BrandBar } from '@/components/Brand';

export default function DashboardScreen() {
  const colors = useColors();
  const store = useAppStore();
  const { invoices, ewbs } = useScopedRecords();
  const [refreshing, setRefreshing] = useState(false);
  const [gstinPicker, setGstinPicker] = useState(false);
  const fy = financialYear();
  const registrations = store.business?.gstRegistrations ?? [];

  // Current financial year (1 April – 31 March). Drafts are not sales yet.
  const stats = useMemo(() => {
    const inYear = (date: string) => date >= fy.from && date <= fy.to;
    const fyInvoices = invoices.filter((invoice) => inYear(invoice.invoiceDate));
    const issued = fyInvoices.filter((invoice) => invoice.status !== 'draft');
    const fyEwbs = ewbs.filter((ewb) => inYear(istDate(ewb.generatedAt)));
    const live = ewbs.map((ewb) => ({ ewb, status: liveEwbStatus(ewb) }));
    return {
      sales: issued.reduce((sum, invoice) => sum + invoiceTotals(invoice).total, 0),
      invoiceCount: fyInvoices.length,
      issuedCount: issued.length,
      drafts: fyInvoices.length - issued.length,
      ewbCount: fyEwbs.filter((ewb) => liveEwbStatus(ewb) !== 'cancelled').length,
      cancelled: fyEwbs.filter((ewb) => liveEwbStatus(ewb) === 'cancelled').length,
      expiringSoon: live.filter(({ status, ewb }) => (status === 'active' || status === 'part_b_pending') && Date.parse(ewb.validUntil) - Date.now() < 8 * 3_600_000),
    };
  }, [invoices, ewbs, fy.from, fy.to]);

  useEffect(() => {
    void store.refreshWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.workspaceId]);
  const wallet = store.wallet;
  const lowCredits = Boolean(wallet && wallet.balance < wallet.costs.generate);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([store.refreshEwbs(), store.syncNow(), store.refreshServices(), store.refreshWallet()]);
    setRefreshing(false);
  };

  const activity = useMemo(() => {
    const items = [
      ...invoices.slice(0, 8).map((invoice) => ({ kind: 'invoice' as const, at: invoice.updatedAt, invoice })),
      ...ewbs.slice(0, 8).map((ewb) => ({ kind: 'ewb' as const, at: ewb.history[ewb.history.length - 1]?.at ?? ewb.generatedAt, ewb })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  }, [invoices, ewbs]);

  const sandbox = store.config?.ewbProvider?.sandbox;
  const lastSync = store.lastSyncAt ?? store.ewbsFetchedAt;

  return (
    <Page contentStyle={styles.page} onRefresh={refresh} refreshing={refreshing}>
      <BrandBar right={<>
        <Pressable
          onPress={() => router.push('/help')}
          accessibilityRole="button"
          accessibilityLabel="Help and support"
          testID="dashboard-help"
          hitSlop={6}
          style={({ pressed }) => [styles.help, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <Feather name="headphones" size={16} color={colors.primary} />
          <TextBlock size={13} weight="semibold" color={colors.primary}>Help</TextBlock>
        </Pressable>
        <AccountButton />
      </>} />
      <View style={styles.topline}>
        <Pressable
          onPress={() => registrations.length > 1 && setGstinPicker(true)}
          style={{ flex: 1, gap: 3 }}
          accessibilityRole={registrations.length > 1 ? 'button' : undefined}
          accessibilityLabel={`Business ${store.business?.name}, GSTIN ${store.activeGstin}${registrations.length > 1 ? '. Tap to switch registration' : ''}`}
        >
          <TextBlock size={16} weight="bold" numberOfLines={1}>{store.business?.name || 'Your business'}</TextBlock>
          <View style={styles.gstinRow}>
            <TextBlock size={12} color={colors.mutedForeground} style={{ letterSpacing: 0.4 }}>{store.activeGstin || 'GSTIN not added'}</TextBlock>
            {registrations.length > 1 ? <Feather name="chevron-down" size={14} color={colors.mutedForeground} /> : null}
          </View>
        </Pressable>
      </View>

      <View style={{ gap: 3 }}>
        <View style={styles.syncRow}>
          <View style={[styles.syncDot, { backgroundColor: store.online === false ? colors.warmAccent : store.syncState === 'error' ? colors.destructive : colors.primary }]} />
          <TextBlock size={12} color={colors.mutedForeground}>
            {store.online === false ? `Offline · showing data from ${lastSync ? relativeTime(lastSync) : 'this device'}` : store.syncState === 'syncing' ? 'Syncing…' : lastSync ? `Synced ${relativeTime(lastSync)}` : 'Not synced yet'}
          </TextBlock>
        </View>
      </View>

      <Pressable onPress={() => router.push('/wallet')} accessibilityRole="button" accessibilityLabel={`Wallet: ${wallet ? `${wallet.balance} credits` : 'balance loading'}. Open wallet`} testID="dashboard-wallet">
        {({ pressed }) => (
          <LinearGradient colors={[colors.heroEnd, colors.heroStart]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.wallet, pressed && { opacity: 0.92 }]}>
            <View style={[styles.walletIcon, { backgroundColor: 'rgba(255, 253, 246, 0.12)' }]}><Feather name="credit-card" size={19} color={colors.warmAccent} /></View>
            <View style={{ flex: 1, gap: 1 }}>
              <TextBlock size={11} weight="bold" color={colors.heroMuted} style={{ letterSpacing: 1 }}>WALLET</TextBlock>
              <TextBlock size={20} weight="bold" color={colors.heroText} numberOfLines={1}>
                {wallet ? wallet.balance : '—'}<TextBlock size={13} weight="semibold" color={lowCredits ? colors.warmAccent : colors.heroMuted}> credits{lowCredits ? ' · low' : ''}</TextBlock>
              </TextBlock>
            </View>
            <Pressable onPress={() => router.push('/wallet')} style={({ pressed: on }) => [styles.walletButton, { backgroundColor: colors.warmAccent, opacity: on ? 0.85 : 1 }]} accessibilityRole="button" testID="dashboard-add-credits">
              <Feather name="plus" size={15} color="#1b1206" />
              <TextBlock size={13} weight="bold" color="#1b1206">Add credits</TextBlock>
            </Pressable>
          </LinearGradient>
        )}
      </Pressable>

      <LinearGradient colors={[colors.heroStart, colors.heroEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroDecor} />
        <TextBlock size={11} weight="bold" color={colors.heroMuted} style={{ letterSpacing: 1 }}>TOTAL SALES · {fy.label}</TextBlock>
        <TextBlock size={32} weight="bold" color={colors.heroText} style={{ letterSpacing: -1 }}>{formatInr(stats.sales)}</TextBlock>
        <TextBlock size={12} color={colors.heroMuted}>{formatDate(fy.from)} – {formatDate(today())} · {stats.issuedCount} invoice{stats.issuedCount === 1 ? '' : 's'}{stats.drafts ? ` · ${stats.drafts} draft${stats.drafts === 1 ? '' : 's'} not counted` : ''}</TextBlock>
        <View style={styles.heroActions}>
          <Pressable onPress={() => router.push('/invoice/new')} style={({ pressed }) => [styles.heroButton, { backgroundColor: colors.warmAccent, opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button" testID="dashboard-new-invoice">
            <Feather name="plus" size={17} color="#1b1206" />
            <TextBlock size={14} weight="bold" color="#1b1206">Create invoice</TextBlock>
          </Pressable>
          <Pressable onPress={() => router.push('/invoice/import')} style={({ pressed }) => [styles.heroButton, styles.heroGhost, { opacity: pressed ? 0.8 : 1 }]} accessibilityRole="button" testID="dashboard-import-pdf">
            <Feather name="upload" size={16} color={colors.heroText} />
            <TextBlock size={14} weight="semibold" color={colors.heroText}>Import PDF</TextBlock>
          </Pressable>
        </View>
      </LinearGradient>

      <View style={styles.stats}>
        <StatCard label="Total invoices" value={String(stats.invoiceCount)} hint={fy.label} icon="file-text" tone="blue" onPress={() => router.push({ pathname: '/(tabs)/invoices', params: { from: fy.from, to: fy.to } })} testID="stat-invoices" />
        <StatCard label="Total e-way bills" value={String(stats.ewbCount)} hint={stats.cancelled ? `${fy.label} · ${stats.cancelled} cancelled` : fy.label} icon="truck" tone="green" onPress={() => router.push({ pathname: '/(tabs)/ewbs', params: { status: 'all' } })} testID="stat-ewbs" />
      </View>

      {sandbox ? <Notice title="Sandbox mode" body="E-way bills come from a test provider. Nothing is sent to the government portal — use test data only." tone="warning" /> : null}
      {store.online === false ? <Notice title="You're offline" body="Drafts keep saving on this device. E-way bill generation needs a connection and is never queued." tone="info" /> : null}
      {store.storageError ? <Notice title="Storage problem" body={store.storageError} tone="danger" /> : null}
      {wallet?.welcomeCredits ? (
        <Notice
          tone="success"
          title={`Get ${wallet.welcomeCredits} free credits`}
          body="Save your e-way bill portal API login for your GSTIN. Once the portal accepts it, the free credits are added to your wallet. Once per GSTIN."
          action="Add portal login"
          onAction={() => router.push('/ewb-login')}
        />
      ) : null}
      {stats.expiringSoon.length ? (
        <Notice
          tone="danger"
          title={`${stats.expiringSoon.length} e-way bill${stats.expiringSoon.length === 1 ? '' : 's'} expiring soon`}
          body={`${stats.expiringSoon[0]!.ewb.ewbNumber} expires ${relativeTime(stats.expiringSoon[0]!.ewb.validUntil)}. Extend it if the goods are still in transit.`}
          action="Review bill"
          onAction={() => router.push(`/ewb/${stats.expiringSoon[0]!.ewb.id}`)}
        />
      ) : null}

      <SectionTitle title="Recent activity" action={activity.length ? 'All invoices' : undefined} onPress={() => router.push('/(tabs)/invoices')} />
      {activity.length ? (
        <View style={{ gap: 10 }}>
          {activity.map((item) => item.kind === 'invoice'
            ? <InvoiceCard key={`i-${item.invoice.id}`} invoice={item.invoice} onPress={() => router.push({ pathname: '/invoice/[id]', params: { id: item.invoice.id, view: '1' } })} />
            : <EwbActivity key={`e-${item.ewb.id}`} ewb={item.ewb} />)}
        </View>
      ) : (
        <Card style={styles.emptyCard}>
          <View style={[styles.emptyMark, { backgroundColor: colors.accent }]}><Feather name="zap" size={21} color={colors.primary} /></View>
          <View style={{ flex: 1, gap: 4 }}>
            <TextBlock size={15} weight="semibold">Create your first invoice</TextBlock>
            <TextBlock size={12} color={colors.mutedForeground} style={{ lineHeight: 17 }}>Fill it once, review it, and generate the e-way bill from the same details.</TextBlock>
          </View>
        </Card>
      )}

      <SelectSheet
        visible={gstinPicker}
        onClose={() => setGstinPicker(false)}
        title="Switch GST registration"
        searchable={false}
        value={store.activeGstin}
        options={registrations.map((registration) => ({ value: registration.gstin, label: registration.displayName || registration.gstin, detail: `${registration.gstin} · ${registration.state || 'State not set'}` }))}
        onSelect={(gstin) => void store.setActiveGstin(gstin)}
      />
    </Page>
  );
}

function EwbActivity({ ewb }: { ewb: Parameters<typeof liveEwbStatus>[0] }) {
  const colors = useColors();
  const status = liveEwbStatus(ewb);
  const meta = ewbStatusMeta(status);
  const last = ewb.history[ewb.history.length - 1];
  return (
    <Card onPress={() => router.push(`/ewb/${ewb.id}`)} style={styles.ewbCard} accessibilityLabel={`E-way bill ${ewb.ewbNumber}, ${meta.label}`}>
      <View style={[styles.ewbIcon, { backgroundColor: colors.warmAccentSoft }]}><Feather name="truck" size={17} color={colors.warningForeground} /></View>
      <View style={{ flex: 1, gap: 3 }}>
        <TextBlock size={14} weight="semibold">EWB {ewb.ewbNumber}</TextBlock>
        <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{last?.action ?? 'Generated'} · {ewb.buyerName} · {relativeTime(last?.at ?? ewb.generatedAt)}</TextBlock>
      </View>
      <StatusPill label={meta.label} tone={meta.tone} />
    </Card>
  );
}

const styles = StyleSheet.create({
  help: { height: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  page: { gap: 16 },
  topline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gstinRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  syncDot: { width: 7, height: 7, borderRadius: 4 },
  hero: { borderRadius: 24, padding: 18, gap: 6, overflow: 'hidden' },
  heroDecor: { position: 'absolute', right: -50, top: -60, width: 180, height: 180, borderRadius: 90, borderWidth: 26, borderColor: 'rgba(247, 236, 216, 0.06)' },
  wallet: { borderRadius: 20, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  walletIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  walletButton: { minHeight: 38, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroActions: { flexDirection: 'row', gap: 9, marginTop: 12 },
  heroButton: { flex: 1, minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  heroGhost: { borderWidth: 1, borderColor: 'rgba(255, 253, 246, 0.28)', backgroundColor: 'rgba(255, 253, 246, 0.06)' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  emptyMark: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  ewbCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 },
  ewbIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
