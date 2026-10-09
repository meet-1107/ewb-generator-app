import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';
import { Card, Heading, Notice, Page, StatusPill, TextBlock } from '@/components/AppUI';

const returns = [
  { name: 'GSTR-1', description: 'Outward supplies' },
  { name: 'GSTR-2', description: 'Provider-reported return type' },
  { name: 'GSTR-3B', description: 'Summary return' },
];

export default function GstStatusScreen() {
  const colors = useColors();
  const { business, activeGstin, setActiveGstin } = useAppStore();
  const [period, setPeriod] = useState('Current period');
  const [showRegistrations, setShowRegistrations] = useState(false);
  const registrations = business?.gstRegistrations?.length
    ? business.gstRegistrations
    : business?.gstin
      ? [{ gstin: business.gstin, displayName: business.name, state: business.state, isDefault: true }]
      : [];
  return (
    <Page contentStyle={styles.page}>
      <Heading eyebrow="Tax overview" title="GST status" subtitle="A read-only view of return status from an authorized provider." />
      <Notice title="GST status provider not configured" body="No portal scraping or portal password collection. Status will show only after a supported provider confirms it." tone="warning" />
      <Card style={styles.selector}>
        <Pressable onPress={() => setShowRegistrations((current) => !current)} style={styles.selectorRow} accessibilityRole="button" accessibilityLabel="Choose GST registration">
          <View style={[styles.selectorIcon, { backgroundColor: colors.accent }]}><Feather name="briefcase" size={17} color={colors.primary} /></View>
          <View style={{ flex: 1, gap: 4 }}>
            <TextBlock size={11} color={colors.mutedForeground}>Selected GST registration</TextBlock>
            <TextBlock weight="semibold">{activeGstin || business?.gstin || 'GSTIN not added'}</TextBlock>
          </View>
          <Feather name="chevron-down" size={17} color={colors.mutedForeground} />
        </Pressable>
        {showRegistrations && registrations.length > 1 ? <View style={styles.registrations}>
          {registrations.map((registration) => <Pressable key={registration.gstin} onPress={() => { void setActiveGstin(registration.gstin); setShowRegistrations(false); }} style={[styles.registrationChoice, { borderColor: activeGstin === registration.gstin ? colors.primary : colors.border, backgroundColor: activeGstin === registration.gstin ? colors.accent : colors.background }]}>
            <View style={{ flex: 1, gap: 3 }}><TextBlock size={12} weight="semibold">{registration.displayName || registration.gstin}</TextBlock><TextBlock size={10} color={colors.mutedForeground}>{registration.gstin} · Not verified</TextBlock></View>
            {activeGstin === registration.gstin ? <Feather name="check" size={16} color={colors.primary} /> : null}
          </Pressable>)}
        </View> : null}
        <View style={[styles.period, { borderColor: colors.border }]}>
          {['Current period', 'Previous period'].map((item) => <Pressable key={item} onPress={() => setPeriod(item)} style={[styles.periodOption, { backgroundColor: item === period ? colors.accent : 'transparent' }]}><TextBlock size={12} weight="semibold" color={item === period ? colors.primary : colors.mutedForeground}>{item}</TextBlock></Pressable>)}
        </View>
      </Card>
      <View style={{ gap: 11 }}>
        {returns.map((item) => (
          <Card key={item.name} style={styles.returnCard}>
            <View style={styles.returnTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <TextBlock size={16} weight="semibold">{item.name}</TextBlock>
                <TextBlock size={12} color={colors.mutedForeground}>{item.description}</TextBlock>
              </View>
              <StatusPill label="Not available" />
            </View>
            <View style={styles.detailRow}>
              <TextBlock size={11} color={colors.mutedForeground}>Period</TextBlock><TextBlock size={11} color={colors.mutedForeground}>{period}</TextBlock>
            </View>
            <View style={styles.detailRow}>
              <TextBlock size={11} color={colors.mutedForeground}>Last checked</TextBlock><TextBlock size={11} color={colors.mutedForeground}>Not checked</TextBlock>
            </View>
            <View style={styles.detailRow}>
              <TextBlock size={11} color={colors.mutedForeground}>Source</TextBlock><TextBlock size={11} color={colors.mutedForeground}>No provider connected</TextBlock>
            </View>
          </Card>
        ))}
      </View>
      <Pressable style={[styles.refresh, { borderColor: colors.border }]} disabled accessibilityRole="button">
        <Feather name="refresh-cw" size={15} color={colors.mutedForeground} /><TextBlock size={13} weight="semibold" color={colors.mutedForeground}>Refresh unavailable until provider setup</TextBlock>
      </Pressable>
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 18 },
  selector: { gap: 13 },
  selectorRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  selectorIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  registrations: { gap: 7 },
  registrationChoice: { minHeight: 48, padding: 10, borderWidth: 1, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  period: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, padding: 3 },
  periodOption: { flex: 1, alignItems: 'center', padding: 9, borderRadius: 9 },
  returnCard: { gap: 13 },
  returnTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  refresh: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 14 },
});
