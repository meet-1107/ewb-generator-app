import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';
import { useAuth } from '@/state/auth';
import { Button, Card, Divider, Field, Heading, Notice, Page, SectionTitle, StatusPill, TextBlock } from '@/components/AppUI';

export default function AccountScreen() {
  const colors = useColors();
  const auth = useAuth();
  const store = useAppStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(store.business?.name ?? '');
  const [gstin, setGstin] = useState(store.business?.gstin ?? '');
  const [address, setAddress] = useState(store.business?.address ?? '');
  const [businessState, setBusinessState] = useState(store.business?.state ?? '');
  const [phone, setPhone] = useState(store.business?.phone ?? '');
  const [email, setEmail] = useState(store.business?.email ?? '');
  const [timezone, setTimezone] = useState(store.business?.timezone ?? 'Asia/Kolkata');
  const [registrationGstin, setRegistrationGstin] = useState('');
  const [registrationName, setRegistrationName] = useState('');
  const [registrationState, setRegistrationState] = useState('');
  const [addingRegistration, setAddingRegistration] = useState(false);
  const registrations = store.business?.gstRegistrations ?? (store.business?.gstin ? [{
    gstin: store.business.gstin,
    displayName: store.business.name,
    state: store.business.state,
    isDefault: true,
  }] : []);

  const save = async () => {
    if (!store.business) return;
    const normalizedGstin = gstin.trim().toUpperCase();
    if (normalizedGstin && !/^[0-9A-Z]{15}$/.test(normalizedGstin)) {
      Alert.alert('Check the GSTIN', 'Enter 15 letters and numbers. This is a format check only, not verification.');
      return;
    }
    const normalizedRegistrations = registrations.map((item) => ({
      ...item,
      isDefault: item.gstin === normalizedGstin,
    }));
    if (normalizedGstin) {
      const existing = normalizedRegistrations.find((item) => item.gstin === normalizedGstin);
      if (existing) existing.displayName = name;
      else normalizedRegistrations.push({ gstin: normalizedGstin, displayName: name, state: businessState, isDefault: true });
    }
    await store.saveBusiness({
      ...store.business,
      name,
      gstin: normalizedGstin,
      defaultGstin: normalizedGstin,
      gstRegistrations: normalizedRegistrations,
      address,
      state: businessState,
      phone,
      email,
      timezone,
    });
    if (normalizedGstin) await store.setActiveGstin(normalizedGstin);
    setEditing(false);
    Alert.alert('Business details saved', 'New invoice drafts will use these details. Existing invoices are unchanged.');
  };

  const addRegistration = async () => {
    if (!store.business) return;
    const normalized = registrationGstin.trim().toUpperCase();
    if (!/^[0-9A-Z]{15}$/.test(normalized)) {
      Alert.alert('Check the GSTIN', 'Enter a 15-character GSTIN. This app will not verify it against a government source.');
      return;
    }
    if (registrations.some((item) => item.gstin === normalized)) {
      Alert.alert('GSTIN already added', 'This registration is already in your business profile.');
      return;
    }
    const makeDefault = registrations.length === 0;
    const next = {
      ...store.business,
      gstRegistrations: [...registrations, { gstin: normalized, displayName: registrationName || store.business.name, state: registrationState, isDefault: makeDefault }],
      ...(makeDefault ? { gstin: normalized, defaultGstin: normalized } : {}),
    };
    await store.saveBusiness(next);
    if (makeDefault) await store.setActiveGstin(normalized);
    setRegistrationGstin('');
    setRegistrationName('');
    setRegistrationState('');
    setAddingRegistration(false);
  };

  const signOut = () => {
    Alert.alert('Sign out and clear local data?', 'Unsynced invoice drafts and business details on this device will be deleted. This cannot be undone.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Clear and sign out', style: 'destructive', onPress: () => { void store.clearLocalData().then(() => auth.signOut()).then(() => router.replace('/')); } },
    ]);
  };
  const clearData = () => {
    Alert.alert('Clear on-device drafts?', 'This permanently removes the business profile and invoice drafts saved on this device.', [
      { text: 'Keep my data', style: 'cancel' },
      { text: 'Clear local data', style: 'destructive', onPress: () => { void store.clearLocalData().then(() => router.replace('/setup')); } },
    ]);
  };

  return (
    <Page contentStyle={styles.page}>
      <Heading eyebrow="Workspace" title="Account" subtitle={auth.user?.displayName || auth.user?.email || 'Local preview'} />
      {auth.previewMode ? <Notice title="Preview-only workspace" body="This session has no authenticated account. Use test details; provider actions and cloud sync are not available." tone="warning" /> : null}
      <View style={styles.headerRow}>
        <SectionTitle title="Business profile" />
        <Pressable onPress={() => setEditing((current) => !current)} hitSlop={8}><TextBlock size={13} weight="semibold" color={colors.primary}>{editing ? 'Cancel' : 'Edit'}</TextBlock></Pressable>
      </View>
      <Card>
        {editing ? (
          <>
            <Field label="Legal business name" value={name} onChangeText={setName} placeholder="Business name" autoCapitalize="words" />
            <Field label="Default GSTIN" value={gstin} onChangeText={setGstin} placeholder="GSTIN" autoCapitalize="characters" />
            <Field label="Business address" value={address} onChangeText={setAddress} placeholder="Address" multiline />
            <Field label="State / union territory" value={businessState} onChangeText={setBusinessState} placeholder="State" />
            <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="Business phone" keyboardType="phone-pad" />
            <Field label="Business email" value={email} onChangeText={setEmail} placeholder="billing@business.com" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Business timezone" value={timezone} onChangeText={setTimezone} placeholder="Asia/Kolkata" autoCapitalize="none" />
            <Button title="Save changes" onPress={save} />
          </>
        ) : (
          <View style={{ gap: 13 }}>
            <SettingRow icon="briefcase" label="Legal name" value={store.business?.name || 'Not set'} />
            <Divider />
            <SettingRow icon="shield" label="GST registration" value={store.business?.gstin || 'Not added'} />
            {registrations.map((registration) => (
              <View key={registration.gstin} style={styles.registrationRow}>
                <View style={{ flex: 1, gap: 3 }}>
                  <TextBlock size={12} weight="semibold">{registration.displayName || store.business?.name}</TextBlock>
                  <TextBlock size={11} color={colors.mutedForeground}>{registration.gstin} · {registration.state || 'State not added'} · Not verified</TextBlock>
                </View>
                {registration.isDefault ? <StatusPill label="Default" tone="green" /> : (
                  <Pressable onPress={() => {
                    if (!store.business) return;
                    const nextRegistrations = registrations.map((item) => ({ ...item, isDefault: item.gstin === registration.gstin }));
                    void store.saveBusiness({ ...store.business, gstin: registration.gstin, defaultGstin: registration.gstin, gstRegistrations: nextRegistrations }).then(() => store.setActiveGstin(registration.gstin));
                  }}>
                    <TextBlock size={11} weight="semibold" color={colors.primary}>Make default</TextBlock>
                  </Pressable>
                )}
              </View>
            ))}
            <Pressable onPress={() => setAddingRegistration((current) => !current)} style={styles.addRegistration}>
              <Feather name="plus-circle" size={15} color={colors.primary} /><TextBlock size={12} weight="semibold" color={colors.primary}>{addingRegistration ? 'Cancel' : 'Add GST registration'}</TextBlock>
            </Pressable>
            {addingRegistration ? <>
              <Field label="GSTIN *" value={registrationGstin} onChangeText={setRegistrationGstin} placeholder="15-character GSTIN" autoCapitalize="characters" />
              <Field label="Display name" value={registrationName} onChangeText={setRegistrationName} placeholder={store.business?.name || 'Business name'} />
              <Field label="State" value={registrationState} onChangeText={setRegistrationState} placeholder="State or territory" />
              <Button title="Add registration" onPress={addRegistration} />
            </> : null}
            <Divider />
            <SettingRow icon="map-pin" label="Address" value={store.business?.address || 'Not added'} />
            <Divider />
            <SettingRow icon="globe" label="State" value={store.business?.state || 'Not added'} />
            <Divider />
            <SettingRow icon="phone" label="Contact" value={store.business?.phone || 'Not added'} />
            <Divider />
            <SettingRow icon="mail" label="Business email" value={store.business?.email || 'Not added'} />
            <View style={[styles.softNote, { backgroundColor: colors.muted }]}><TextBlock size={11} color={colors.mutedForeground}>GSTIN source / verification: Not checked</TextBlock></View>
          </View>
        )}
      </Card>

      <SectionTitle title="Saved details" />
      <Card style={{ padding: 0 }}>
        <SettingLink icon="users" title="Buyers & receivers" detail="No saved buyers" />
        <Divider />
        <SettingLink icon="package" title="Products & services" detail="No saved items" />
        <Divider />
        <SettingLink icon="truck" title="Transporters" detail="No saved transporters" />
        <Divider />
        <SettingLink icon="layout" title="Invoice layouts" detail="6 reusable templates" />
      </Card>

      <SectionTitle title="Subscription & usage" />
      <Card>
        <SettingRow icon="credit-card" label="Billing setup" value="Not configured" />
        <TextBlock size={12} color={colors.mutedForeground} style={{ lineHeight: 18 }}>Plan limits, pricing, purchase and renewal terms need approval before billing can be enabled. Historic records should remain accessible if a plan lapses.</TextBlock>
        <Button title="Manage subscription unavailable" secondary disabled onPress={() => undefined} />
      </Card>

      <SectionTitle title="App & support" />
      <Card style={{ padding: 0 }}>
        <SettingLink icon="help-circle" title="Help & support" detail="Support contact not configured" />
        <Divider />
        <SettingLink icon="lock" title="Privacy & terms" detail="Read the policies before launch" />
        <Divider />
        <SettingLink icon="download" title="Data export" detail="Available after secure sync is connected" />
        <Divider />
        <SettingLink icon="trash-2" title="Request account deletion" detail="Deletion flow not configured" />
      </Card>
      {auth.previewMode ? <Button title="Clear local preview data" icon="trash-2" secondary onPress={clearData} /> : null}
      <Button title={auth.previewMode ? 'Exit local preview' : 'Sign out'} icon="log-out" secondary onPress={signOut} />
      <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center' }}>English · INR · Business timezone {store.business?.timezone || 'Asia/Kolkata'}</TextBlock>
    </Page>
  );
}

function SettingRow({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  const colors = useColors();
  return <View style={styles.settingRow}><Feather name={icon} size={16} color={colors.primary} /><View style={{ flex: 1, gap: 3 }}><TextBlock size={11} color={colors.mutedForeground}>{label}</TextBlock><TextBlock size={13} weight="medium">{value}</TextBlock></View></View>;
}

function SettingLink({ icon, title, detail }: { icon: keyof typeof Feather.glyphMap; title: string; detail: string }) {
  const colors = useColors();
  return <Pressable onPress={() => Alert.alert(title, detail)} style={styles.settingLink}><Feather name={icon} size={17} color={colors.primary} /><View style={{ flex: 1, gap: 4 }}><TextBlock size={13} weight="semibold">{title}</TextBlock><TextBlock size={11} color={colors.mutedForeground}>{detail}</TextBlock></View><Feather name="chevron-right" size={16} color={colors.mutedForeground} /></Pressable>;
}

const styles = StyleSheet.create({
  page: { gap: 17 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  registrationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 26, paddingVertical: 5 },
  addRegistration: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8 },
  settingLink: { minHeight: 66, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  softNote: { padding: 10, borderRadius: 11, alignItems: 'center' },
});
