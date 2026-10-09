import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';
import { Button, Card, EmptyState, Heading, Notice, Page, TextBlock } from '@/components/AppUI';

const statuses = ['All', 'Active', 'Expired', 'Cancelled', 'Check needed'];

export default function EwbRegisterScreen() {
  const colors = useColors();
  const { invoices } = useAppStore();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');
  return (
    <Page contentStyle={styles.page}>
      <Heading eyebrow="Movement records" title="E-way bills" subtitle="Your generated bills and provider checks, in one place." />
      <Notice title="EWB provider setup required" body="This app does not yet connect to an authorized EWB provider. No bill has been generated or verified here." tone="warning" />
      <View style={[styles.search, { borderColor: colors.input, backgroundColor: colors.card }]}>
        <Feather name="search" size={17} color={colors.mutedForeground} />
        <TextInput value={query} onChangeText={setQuery} placeholder="EWB, invoice, buyer or vehicle" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} accessibilityLabel="Search e-way bills" />
        {query ? <Pressable onPress={() => setQuery('')}><Feather name="x-circle" size={17} color={colors.mutedForeground} /></Pressable> : null}
      </View>
      <View style={styles.statuses}>
        {statuses.map((item) => <Pressable key={item} onPress={() => setStatus(item)} style={[styles.chip, { backgroundColor: status === item ? colors.primary : colors.card, borderColor: status === item ? colors.primary : colors.border }]}><TextBlock size={12} weight="semibold" color={status === item ? '#fff' : colors.mutedForeground}>{item}</TextBlock></Pressable>)}
      </View>
      <Card>
        <EmptyState
          icon="truck"
          title={query ? 'No matching bills' : 'No e-way bills yet'}
          body={invoices.length ? 'Your saved invoices are ready for review. A bill can be generated only after provider setup and your confirmation.' : 'Create an invoice first. Generated bills will appear here only after a provider confirms success.'}
        />
      </Card>
      <Button title="View invoices" icon="file-text" secondary onPress={() => router.push('/(tabs)/invoices')} />
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { gap: 17 },
  search: { borderWidth: 1, borderRadius: 15, height: 51, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', paddingVertical: 10 },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 99 },
});
