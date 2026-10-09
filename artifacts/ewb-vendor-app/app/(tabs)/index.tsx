import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';
import { useAuth } from '@/state/auth';
import { formatInr, invoiceTotals } from '@/lib/domain';
import { Card, Heading, Notice, Page, SectionTitle, StatusPill, TextBlock } from '@/components/AppUI';
import InvoiceCard from '@/components/InvoiceCard';

export default function DashboardScreen() {
  const colors = useColors();
  const store = useAppStore();
  const auth = useAuth();
  const [showBusinesses, setShowBusinesses] = useState(false);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const visibleInvoices = store.invoices.filter((invoice) =>
    !store.activeGstin || invoice.sellerGstin.toUpperCase() === store.activeGstin.toUpperCase(),
  );
  const monthInvoices = visibleInvoices.filter((invoice) => invoice.invoiceDate.startsWith(currentMonth));
  const monthTotal = monthInvoices.reduce((sum, invoice) => sum + invoiceTotals(invoice).total, 0);

  return (
    <Page contentStyle={styles.page}>
      <View style={styles.topline}>
        <View style={{ flex: 1 }}>
          <TextBlock size={11} weight="bold" color={colors.primary} style={{ letterSpacing: 1 }}>MARG / EWB DESK</TextBlock>
          <Pressable onPress={() => setShowBusinesses((current) => !current)} style={styles.businessSelector}>
            <TextBlock size={14} weight="semibold" color={colors.foreground} style={{ marginTop: 4 }}>{store.business?.name || 'Your business'}</TextBlock>
            {store.business?.gstRegistrations && store.business.gstRegistrations.length > 1 ? <Feather name="chevron-down" size={14} color={colors.mutedForeground} /> : null}
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open account" onPress={() => router.push('/(tabs)/account')} style={[styles.avatar, { borderColor: colors.border, backgroundColor: colors.card }]}>
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
        <View style={{ flex: 1, gap: 3 }}>
          <TextBlock size={13} color={colors.mutedForeground}>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</TextBlock>
          <TextBlock size={25} weight="bold" style={styles.greetTitle}>Make today move.</TextBlock>
        </View>
      </View>
      {auth.previewMode || store.previewOnly ? (
        <Notice title={auth.previewMode ? 'Local preview workspace' : 'Local draft storage'} body="Drafts are saved on this device only. Use test details until secure business sync is connected." tone="warning" />
      ) : null}
      {store.storageError ? <Notice title="Local storage problem" body={store.storageError} tone="warning" /> : null}

      <LinearGradient colors={[colors.heroStart, colors.heroEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.monthCard}>
        <View style={styles.monthCardHeader}>
          <TextBlock size={10} weight="bold" color={colors.heroMuted} style={{ letterSpacing: 1 }}>THIS MONTH · SAVED INVOICES</TextBlock>
          <View style={[styles.localBadge, { backgroundColor: colors.heroDecoration }]}><View style={[styles.localDot, { backgroundColor: colors.warmAccent }]} /><TextBlock size={9} weight="bold" color={colors.heroMuted}>ON DEVICE</TextBlock></View>
        </View>
        <View style={styles.monthStats}>
          <View style={{ flex: 1, gap: 2 }}>
            <TextBlock size={38} weight="bold" color={colors.heroText}>{String(monthInvoices.length).padStart(2, '0')}</TextBlock>
            <TextBlock size={12} color={colors.heroMuted}>{monthInvoices.length === 1 ? 'invoice saved' : 'invoices saved'}</TextBlock>
          </View>
          <View style={[styles.monthSeparator, { backgroundColor: colors.heroDecoration }]} />
          <View style={{ flex: 1, gap: 4 }}>
            <TextBlock size={10} weight="semibold" color={colors.heroMuted}>TOTAL VALUE</TextBlock>
            <TextBlock size={19} weight="bold" color={colors.heroText}>{formatInr(monthTotal)}</TextBlock>
            <TextBlock size={9} color={colors.heroMuted}>Not filed or submitted</TextBlock>
          </View>
        </View>
        <Pressable onPress={() => router.push('/(tabs)/invoices')} style={styles.monthLink}>
          <TextBlock size={11} weight="semibold" color={colors.heroText}>View invoice library</TextBlock>
          <Feather name="arrow-up-right" size={14} color={colors.warmAccent} />
        </Pressable>
      </LinearGradient>

      <View style={styles.quickActions}>
        <Pressable onPress={() => router.push('/invoice/new')} style={[styles.quickAction, { backgroundColor: colors.primary, borderColor: colors.primary }]} testID="dashboard-new-invoice">
          <View style={[styles.quickIcon, { backgroundColor: colors.heroDecoration }]}><Feather name="plus" size={18} color={colors.warmAccent} /></View>
          <View style={{ flex: 1, gap: 4 }}><TextBlock size={13} weight="semibold" color={colors.primaryForeground}>New invoice</TextBlock><TextBlock size={10} color={colors.heroMuted}>Start a clean draft</TextBlock></View>
          <Feather name="arrow-up-right" size={15} color={colors.heroMuted} />
        </Pressable>
        <Pressable onPress={() => router.push('/invoice/import')} style={[styles.quickAction, { backgroundColor: colors.card, borderColor: colors.border }]} testID="dashboard-import-pdf">
          <View style={[styles.quickIcon, { backgroundColor: colors.warmAccentSoft }]}><Feather name="file-plus" size={17} color={colors.warningForeground} /></View>
          <View style={{ flex: 1, gap: 4 }}><TextBlock size={13} weight="semibold">Import a PDF</TextBlock><TextBlock size={10} color={colors.mutedForeground}>Enter details manually</TextBlock></View>
          <Feather name="arrow-up-right" size={15} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <SectionTitle title="Connected services" />
      <Pressable onPress={() => router.push('/(tabs)/gst')} style={[styles.serviceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.serviceIcon, { backgroundColor: colors.warmAccentSoft }]}><Feather name="bar-chart-2" size={17} color={colors.warningForeground} /></View>
        <View style={{ flex: 1, gap: 4 }}><TextBlock size={13} weight="semibold">GST returns</TextBlock><TextBlock size={11} color={colors.mutedForeground}>Connect a trusted status provider</TextBlock></View>
        <StatusPill label="Not connected" tone="amber" />
      </Pressable>
      <Pressable onPress={() => router.push('/(tabs)/ewbs')} style={[styles.serviceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.serviceIcon, { backgroundColor: colors.accent }]}><Feather name="truck" size={17} color={colors.primary} /></View>
        <View style={{ flex: 1, gap: 4 }}><TextBlock size={13} weight="semibold">E-way bill provider</TextBlock><TextBlock size={11} color={colors.mutedForeground}>Generation stays locked until setup</TextBlock></View>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </Pressable>

      <SectionTitle title="Recent invoices" action="See all" onPress={() => router.push('/(tabs)/invoices')} />
      {visibleInvoices.length ? (
        <View style={{ gap: 10 }}>
          {visibleInvoices.slice(0, 3).map((invoice) => (
            <InvoiceCard key={invoice.id} invoice={invoice} onPress={() => router.push(`/invoice/${invoice.id}`)} />
          ))}
        </View>
      ) : (
        <Card style={styles.emptyCard}>
          <View style={[styles.emptyMark, { backgroundColor: colors.accent }]}><Feather name="file-text" size={21} color={colors.primary} /></View>
          <View style={{ flex: 1, gap: 4 }}><TextBlock size={14} weight="semibold">Your first invoice starts here</TextBlock><TextBlock size={11} color={colors.mutedForeground}>Saved drafts and their totals appear here.</TextBlock></View>
          <Feather name="arrow-right" size={16} color={colors.primary} />
        </Card>
      )}
      <TextBlock size={10} color={colors.mutedForeground} style={styles.footerNote}>Counts and totals are based on local drafts only.</TextBlock>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 15, paddingTop: 8 },
  topline: { flexDirection: 'row', alignItems: 'center' },
  businessSelector: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  gstinChoice: { minHeight: 49, padding: 10, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  greeting: { flexDirection: 'row', alignItems: 'center' },
  greetTitle: { letterSpacing: -0.8, marginTop: 1 },
  monthCard: { borderRadius: 23, padding: 17, gap: 16 },
  monthCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  localBadge: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 },
  localDot: { width: 5, height: 5, borderRadius: 3 },
  monthStats: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  monthSeparator: { width: 1, height: 45 },
  monthLink: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(247, 236, 216, 0.24)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickActions: { flexDirection: 'row', gap: 9 },
  quickAction: { flex: 1, minHeight: 94, borderRadius: 18, borderWidth: 1, padding: 11, gap: 9, justifyContent: 'space-between' },
  quickIcon: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  serviceCard: { minHeight: 68, borderWidth: 1, borderRadius: 17, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  serviceIcon: { width: 37, height: 37, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 },
  emptyMark: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  footerNote: { textAlign: 'center', paddingBottom: 2 },
});
