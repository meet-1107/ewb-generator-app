import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';
import { useAuth } from '@/state/auth';
import { formatInr, invoiceTotals } from '@/lib/domain';
import { Button, Card, Heading, Notice, Page, SectionTitle, StatusPill, TextBlock } from '@/components/AppUI';
import InvoiceCard from '@/components/InvoiceCard';

export default function DashboardScreen() {
  const colors = useColors();
  const store = useAppStore();
  const auth = useAuth();
  const [showBusinesses, setShowBusinesses] = useState(false);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthInvoices = store.invoices.filter((invoice) =>
    invoice.invoiceDate.startsWith(currentMonth) &&
    (!store.activeGstin || invoice.sellerGstin.toUpperCase() === store.activeGstin.toUpperCase()),
  );
  const monthTotal = monthInvoices.reduce((sum, invoice) => sum + invoiceTotals(invoice).total, 0);

  const summary = [
    { label: 'Invoices this period', value: String(monthInvoices.length), icon: 'file-text' as const, tab: '/(tabs)/invoices' },
    { label: 'EWB generated', value: '—', icon: 'truck' as const, tab: '/(tabs)/ewbs' },
    { label: 'Active EWB', value: '—', icon: 'check-circle' as const, tab: '/(tabs)/ewbs' },
    { label: 'Expired EWB', value: '—', icon: 'clock' as const, tab: '/(tabs)/ewbs' },
  ];

  return (
    <Page contentStyle={styles.page}>
      <View style={styles.topline}>
        <View style={{ flex: 1 }}>
          <TextBlock size={12} weight="bold" color={colors.primary} style={{ letterSpacing: 1 }}>MARG / EWB DESK</TextBlock>
          <Pressable onPress={() => setShowBusinesses((current) => !current)} style={styles.businessSelector}>
            <TextBlock size={14} color={colors.mutedForeground} style={{ marginTop: 5 }}>{store.business?.name || 'Your business'}</TextBlock>
            {store.business?.gstRegistrations && store.business.gstRegistrations.length > 1 ? <Feather name="chevron-down" size={14} color={colors.mutedForeground} /> : null}
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open account" onPress={() => router.push('/(tabs)/account')} style={[styles.avatar, { backgroundColor: colors.accent }]}>
          <Feather name="user" size={18} color={colors.primary} />
        </Pressable>
      </View>
      {showBusinesses && store.business?.gstRegistrations && store.business.gstRegistrations.length > 1 ? (
        <Card style={{ gap: 8 }}>
          <TextBlock size={12} weight="semibold">Dashboard for GST registration</TextBlock>
          {store.business.gstRegistrations.map((registration) => (
            <Pressable
              key={registration.gstin}
              onPress={() => { void store.setActiveGstin(registration.gstin); setShowBusinesses(false); }}
              style={[styles.gstinChoice, { borderColor: store.activeGstin === registration.gstin ? colors.primary : colors.border, backgroundColor: store.activeGstin === registration.gstin ? colors.accent : colors.background }]}
            >
              <View style={{ flex: 1, gap: 3 }}><TextBlock size={12} weight="semibold">{registration.displayName || registration.gstin}</TextBlock><TextBlock size={10} color={colors.mutedForeground}>{registration.gstin} · Not verified</TextBlock></View>
              {store.activeGstin === registration.gstin ? <Feather name="check" size={16} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </Card>
      ) : null}
      <View style={styles.greeting}>
        <View style={{ flex: 1 }}>
          <TextBlock size={13} color={colors.mutedForeground}>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</TextBlock>
          <TextBlock size={27} weight="bold" style={styles.greetTitle}>Good to see you.</TextBlock>
        </View>
        <View style={[styles.syncDot, { backgroundColor: '#e9eee5' }]}><View style={styles.greenDot} /><TextBlock size={10} weight="semibold" color={colors.primary}>Local</TextBlock></View>
      </View>
      {auth.previewMode || store.previewOnly ? (
        <Notice title={auth.previewMode ? 'Local preview workspace' : 'Local draft storage'} body="Drafts are saved on this device only. Use test details until secure business sync is connected." tone="warning" />
      ) : null}
      {store.storageError ? <Notice title="Local storage problem" body={store.storageError} tone="warning" /> : null}

      <View style={styles.stats}>
        {summary.map((item, index) => (
          <Pressable key={item.label} onPress={() => router.push(item.tab)} accessibilityRole="button" style={[styles.stat, { backgroundColor: index === 0 ? colors.primary : colors.card, borderColor: colors.border }]}>
            <View style={[styles.statIcon, { backgroundColor: index === 0 ? 'rgba(255,255,255,0.14)' : colors.accent }]}><Feather name={item.icon} size={15} color={index === 0 ? '#fff' : colors.primary} /></View>
            <TextBlock size={24} weight="bold" color={index === 0 ? '#fff' : colors.foreground}>{item.value}</TextBlock>
            <TextBlock size={11} color={index === 0 ? '#deebe3' : colors.mutedForeground} style={{ lineHeight: 15 }}>{item.label}</TextBlock>
          </Pressable>
        ))}
      </View>
      {monthInvoices.length > 0 ? (
        <Card style={styles.periodCard}>
          <View style={{ flex: 1, gap: 3 }}>
            <TextBlock size={12} color={colors.mutedForeground}>Draft invoice value this month</TextBlock>
            <TextBlock size={20} weight="bold">{formatInr(monthTotal)}</TextBlock>
          </View>
          <Feather name="trending-up" size={19} color={colors.primary} />
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button title="Create invoice" icon="plus" onPress={() => router.push('/invoice/new')} />
        <Button title="Import invoice PDF" icon="upload" secondary onPress={() => router.push('/invoice/import')} />
      </View>

      <View style={styles.gstHeading}>
        <SectionTitle title="GST return status" action="View all" onPress={() => router.push('/(tabs)/gst')} />
        <TextBlock size={12} color={colors.mutedForeground}>Status from a provider, not estimated</TextBlock>
      </View>
      <View style={styles.gstStrip}>
        {['GSTR-1', 'GSTR-2', 'GSTR-3B'].map((item) => (
          <Pressable key={item} onPress={() => router.push('/(tabs)/gst')} style={[styles.gstItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextBlock size={13} weight="semibold">{item}</TextBlock>
            <StatusPill label="Not checked" />
            <TextBlock size={10} color={colors.mutedForeground}>No source connected</TextBlock>
          </Pressable>
        ))}
      </View>
      <Notice title="GST status provider not configured" body="Return status needs an authorized provider. This app will not guess whether a return is filed." />

      <SectionTitle title="Recent activity" action="All invoices" onPress={() => router.push('/(tabs)/invoices')} />
      {store.invoices.length ? (
        <View style={{ gap: 10 }}>
          {store.invoices.slice(0, 3).map((invoice) => (
            <InvoiceCard key={invoice.id} invoice={invoice} onPress={() => router.push(`/invoice/${invoice.id}`)} />
          ))}
        </View>
      ) : (
        <Card style={{ padding: 0 }}>
          <View style={{ paddingHorizontal: 8 }}>
            <View style={{ height: 3, backgroundColor: colors.accent, borderRadius: 2, width: 56 }} />
          </View>
          <View style={{ alignItems: 'center', padding: 20, gap: 9 }}>
            <Feather name="inbox" size={23} color={colors.primary} />
            <TextBlock weight="semibold">Nothing here yet</TextBlock>
            <TextBlock size={13} color={colors.mutedForeground} style={{ textAlign: 'center', lineHeight: 19 }}>Create your first invoice to start preparing for an e-way bill.</TextBlock>
          </View>
        </Card>
      )}
      <TextBlock size={11} color={colors.mutedForeground}>Draft invoice value · {store.invoices.length} saved on this device</TextBlock>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 19, paddingTop: 14 },
  topline: { flexDirection: 'row', alignItems: 'center' },
  businessSelector: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  gstinChoice: { minHeight: 49, padding: 10, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  greeting: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  greetTitle: { letterSpacing: -0.8, marginTop: 4 },
  syncDot: { borderRadius: 99, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, marginBottom: 4 },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#428252' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '48%', flexGrow: 1, minHeight: 117, borderRadius: 18, borderWidth: 1, padding: 13, justifyContent: 'space-between' },
  statIcon: { width: 29, height: 29, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  periodCard: { flexDirection: 'row', alignItems: 'center' },
  actions: { gap: 9 },
  gstHeading: { gap: 8 },
  gstStrip: { flexDirection: 'row', gap: 7 },
  gstItem: { flex: 1, minWidth: 95, padding: 10, borderRadius: 14, borderWidth: 1, gap: 9 },
});
