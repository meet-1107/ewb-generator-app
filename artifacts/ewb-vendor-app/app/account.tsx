import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';
import { useAuth } from '@/state/auth';
import { setThemePreference, useThemePreference, type ThemePreference } from '@/state/theme';
import { defaultBank, gstinProblem, relativeTime, STATES, stateForGstin, templates, type Business } from '@/lib/domain';
import { Button, Card, Divider, Field, Heading, ListRow, Notice, Page, Segmented, SectionTitle, SelectField, Sheet, StatusPill, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { BrandBar } from '@/components/Brand';
import { SUPPORT_EMAIL } from '@/lib/api';

const stateOptions = STATES.map((state) => ({ value: state.name, label: state.name }));

export default function AccountScreen() {
  const colors = useColors();
  const auth = useAuth();
  const store = useAppStore();
  const dialog = useDialog();
  const theme = useThemePreference();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Business | null>(store.business);
  const [formError, setFormError] = useState<Record<string, string>>({});

  useEffect(() => {
    void store.refreshWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const business = store.business;
  const registrations = business?.gstRegistrations ?? [];
  const name = auth.user?.displayName || (auth.previewMode ? 'Preview workspace' : auth.user?.email) || 'Your account';
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  const saveProfile = async () => {
    if (!form || !business) return;
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Business name is required.';
    if (form.pincode && !/^[1-9]\d{5}$/.test(form.pincode)) errors.pincode = 'PIN code must be 6 digits.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email.';
    setFormError(errors);
    if (Object.keys(errors).length) return;
    await store.saveBusiness({ ...business, ...form, name: form.name.trim() });
    setEditing(false);
    dialog.toast('Business profile saved. Existing invoices and bills are unchanged.', 'success');
  };

  const addRegistration = async () => {
    if (!business) return;
    const result = await dialog.prompt({
      title: 'Add GST registration',
      message: 'For businesses registered in more than one state. Format and check digit are validated; the portal is not contacted.',
      inputLabel: 'GSTIN',
      placeholder: '29AABCT1332L1ZA',
      autoCapitalize: 'characters',
      requireInput: true,
      confirmLabel: 'Add',
      validate: ({ text }) => {
        const gstin = text.toUpperCase();
        if (registrations.some((item) => item.gstin === gstin)) return 'This GSTIN is already added.';
        return gstinProblem(gstin);
      },
    });
    if (!result) return;
    const gstin = result.text.toUpperCase();
    const state = stateForGstin(gstin)?.name ?? '';
    await store.saveBusiness({ ...business, gstRegistrations: [...registrations, { gstin, displayName: `${business.name} · ${state}`, state, isDefault: false }] });
    dialog.toast(`${gstin} added`, 'success');
  };

  const registrationActions = async (gstin: string) => {
    if (!business) return;
    const registration = registrations.find((item) => item.gstin === gstin)!;
    const choices = [
      ...(store.activeGstin !== gstin ? ['Switch dashboard to this GSTIN'] : []),
      ...(!registration.isDefault ? ['Make default for new invoices', 'Remove registration'] : []),
    ];
    if (!choices.length) {
      await dialog.alert({ title: gstin, message: 'This is your default and active registration. Add another registration to switch between them.' });
      return;
    }
    const result = await dialog.prompt({ title: gstin, message: `${registration.state} · Format checked, not verified with the GST portal.`, choices });
    if (!result) return;
    if (result.choice.startsWith('Switch')) {
      await store.setActiveGstin(gstin);
      dialog.toast(`Showing ${gstin}`);
    } else if (result.choice.startsWith('Make default')) {
      await store.saveBusiness({ ...business, gstin, defaultGstin: gstin, state: registration.state, gstRegistrations: registrations.map((item) => ({ ...item, isDefault: item.gstin === gstin })) });
      dialog.toast('Default registration updated', 'success');
    } else {
      const ok = await dialog.confirm({ title: 'Remove this registration?', message: 'Invoices and e-way bills already created with it are kept. You can add it again later.', confirmLabel: 'Remove', tone: 'danger', icon: 'trash-2' });
      if (!ok) return;
      await store.saveBusiness({ ...business, gstRegistrations: registrations.filter((item) => item.gstin !== gstin) });
      if (store.activeGstin === gstin) await store.setActiveGstin(business.defaultGstin ?? business.gstin);
      dialog.toast('Registration removed');
    }
  };

  const chooseLayout = async () => {
    if (!business) return;
    const result = await dialog.prompt({ title: 'Default invoice layout', message: 'Used for new invoices. You can still change it per invoice.', choices: templates.map((item) => `${item.name} — ${item.note}`) });
    if (!result) return;
    const template = templates.find((item) => result.choice.startsWith(item.name))!;
    await store.saveBusiness({ ...business, defaultTemplateId: template.id });
    dialog.toast(`New invoices will use ${template.name}`, 'success');
  };

  const exportData = async () => {
    const json = store.exportData();
    try {
      await Share.share({ title: 'EWB Vendor data export', message: json });
    } catch {
      dialog.toast('Could not open the share sheet', 'danger');
    }
  };

  const requestDeletion = async () => {
    const ok = await dialog.confirm({
      title: 'Request account deletion?',
      message: 'We will delete your workspace, invoices and saved details after verifying the request. E-way bill records may be retained where the law requires it.',
      confirmLabel: 'Email request',
      tone: 'danger',
      icon: 'user-x',
    });
    if (!ok) return;
    if (!SUPPORT_EMAIL) {
      await dialog.alert({ title: 'Support not configured', message: 'Set EXPO_PUBLIC_SUPPORT_EMAIL so deletion requests reach your support team.', tone: 'warning' });
      return;
    }
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Account deletion request')}&body=${encodeURIComponent(`Workspace: ${store.workspaceId ?? ''}`)}`).catch(() => dialog.toast('No email app found', 'danger'));
  };

  const signOut = async () => {
    const ok = await dialog.confirm({
      title: auth.previewMode ? 'Leave preview?' : 'Sign out?',
      message: auth.previewMode
        ? 'Your preview data stays on this device until you clear it.'
        : 'Your synced data stays safe in your account. Data on this device is cleared for privacy.',
      confirmLabel: auth.previewMode ? 'Leave preview' : 'Sign out',
      icon: 'log-out',
    });
    if (!ok) return;
    if (!auth.previewMode) {
      await store.syncNow();
      await store.clearLocalData();
    }
    await auth.signOut();
    router.replace('/');
  };

  const clearPreview = async () => {
    const ok = await dialog.confirm({ title: 'Clear preview data?', message: 'This removes the business profile and every draft from this device. It cannot be undone.', confirmLabel: 'Clear data', tone: 'danger', icon: 'trash-2' });
    if (!ok) return;
    await store.clearLocalData();
    router.replace('/setup');
  };

  return (
    <Page contentStyle={styles.page} tab={false}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="account-back"
        style={({ pressed }) => [styles.back, { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 }]}
      >
        <Feather name="arrow-left" size={18} color={colors.primary} />
        <TextBlock size={14} weight="bold" color={colors.primary}>Back</TextBlock>
      </Pressable>
      <BrandBar />
      <Heading eyebrow="Settings" title="Account" />

      <Card style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}><TextBlock size={18} weight="bold" color={colors.primaryForeground}>{initials || 'U'}</TextBlock></View>
        <View style={{ flex: 1, gap: 3 }}>
          <TextBlock size={16} weight="semibold" numberOfLines={1}>{name}</TextBlock>
          <TextBlock size={12} color={colors.mutedForeground} numberOfLines={1}>{auth.user?.email ?? 'Test data only · not signed in'}</TextBlock>
        </View>
        {auth.previewMode ? <StatusPill label="Preview" tone="amber" /> : <StatusPill label="Verified" tone="green" icon="check" />}
      </Card>

      <SectionTitle title="Business profile" action="Edit" onPress={() => { setForm(store.business); setEditing(true); }} />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow icon="briefcase" title={business?.name || 'Not set'} detail={[business?.address, business?.state, business?.pincode].filter(Boolean).join(', ') || 'Add your address'} onPress={() => { setForm(store.business); setEditing(true); }} />
        <Divider inset={64} />
        <ListRow icon="phone" title="Contact" detail={[business?.phone, business?.email].filter(Boolean).join(' · ') || 'Not added'} />
      </Card>

      <SectionTitle title="GST registrations" count={registrations.length} action="Add" onPress={() => void addRegistration()} />
      <Card style={{ padding: 0, gap: 0 }}>
        {registrations.map((registration, index) => (
          <React.Fragment key={registration.gstin}>
            {index ? <Divider inset={64} /> : null}
            <ListRow
              icon="shield"
              title={registration.gstin}
              detail={`${registration.state || 'State not set'} · ${business?.verified && registration.gstin === business.gstin ? `verified · ${business.verified.status}` : 'format checked'}`}
              onPress={() => void registrationActions(registration.gstin)}
              right={<View style={{ gap: 4, alignItems: 'flex-end' }}>
                {registration.isDefault ? <StatusPill label="Default" tone="green" /> : null}
                {store.activeGstin === registration.gstin ? <StatusPill label="Showing" tone="blue" /> : null}
              </View>}
            />
          </React.Fragment>
        ))}
      </Card>

      <SectionTitle title="Saved details" />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow icon="users" title="Buyers" detail={`${store.parties.length} saved`} onPress={() => router.push('/saved/parties')} testID="saved-parties" />
        <Divider inset={64} />
        <ListRow icon="package" title="Products" detail={`${store.products.length} saved`} onPress={() => router.push('/saved/products')} testID="saved-products" />
        <Divider inset={64} />
        <ListRow icon="credit-card" title="Bank details" detail={business?.bankAccounts?.length ? `${business.bankAccounts.length} saved · ${defaultBank(business)?.bankName ?? ''} on new invoices` : 'Not added'} onPress={() => router.push('/bank-details')} testID="saved-banks" />
        <Divider inset={64} />
        <ListRow icon="truck" title="Transporters" detail={`${store.transporters.length} saved`} onPress={() => router.push('/saved/transporters')} />
        <Divider inset={64} />
        <ListRow icon="layout" title="Default invoice layout" detail={templates.find((item) => item.id === (business?.defaultTemplateId ?? 'classic'))?.name} onPress={() => void chooseLayout()} />
      </Card>

      <SectionTitle title="Wallet" action="Open" onPress={() => router.push('/wallet')} />
      <Card onPress={() => router.push('/wallet')} accessibilityLabel="Open wallet">
        <View style={styles.planTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <TextBlock size={16} weight="bold">{store.wallet ? `${store.wallet.balance} credits` : 'Credits'}</TextBlock>
            <TextBlock size={12} color={colors.mutedForeground}>
              {store.wallet ? `${store.wallet.counts.generate} e-way bill${store.wallet.counts.generate === 1 ? '' : 's'} generated · ${store.wallet.costs.generate} credits each` : store.online === false ? 'Offline' : 'Loading…'}
            </TextBlock>
          </View>
          {store.wallet ? <StatusPill label={store.wallet.balance < store.wallet.costs.generate ? 'Low' : 'OK'} tone={store.wallet.balance < store.wallet.costs.generate ? 'amber' : 'green'} icon="credit-card" /> : null}
        </View>
      </Card>
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow icon="key" title="E-way bill portal login" detail="API username & password for each GSTIN" onPress={() => router.push('/ewb-login')} testID="ewb-login" />
      </Card>

      <SectionTitle title="Preferences" />
      <Card>
        <TextBlock size={13} weight="semibold">Appearance</TextBlock>
        <Segmented<ThemePreference> options={[{ label: 'System', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]} value={theme} onChange={(value) => void setThemePreference(value)} />
        <Divider />
        <View style={styles.planTop}>
          <View style={{ flex: 1, gap: 2 }}>
            <TextBlock size={14} weight="semibold">Cloud sync</TextBlock>
            <TextBlock size={12} color={colors.mutedForeground}>{store.syncState === 'syncing' ? 'Syncing now…' : store.online === false ? 'Offline — changes are saved on this device' : store.lastSyncAt ? `Last synced ${relativeTime(store.lastSyncAt)}` : 'Not synced yet'}</TextBlock>
          </View>
          <Button title="Sync now" size="sm" variant="outline" icon="refresh-cw" onPress={() => void store.syncNow().then(() => dialog.toast('Sync complete', 'success'))} loading={store.syncState === 'syncing'} />
        </View>
        <Divider />
        <View style={styles.planTop}>
          <TextBlock size={14} weight="semibold" style={{ flex: 1 }}>Language & currency</TextBlock>
          <TextBlock size={13} color={colors.mutedForeground}>English · ₹ INR</TextBlock>
        </View>
      </Card>

      <SectionTitle title="Help & data" />
      <Card style={{ padding: 0, gap: 0 }}>
        <ListRow icon="help-circle" title="Help & support" detail="Guides, FAQs and contact" onPress={() => router.push('/help')} />
        <Divider inset={64} />
        <ListRow icon="lock" title="Privacy & terms" detail="How your data is handled" onPress={() => router.push({ pathname: '/help', params: { section: 'privacy' } })} />
        <Divider inset={64} />
        <ListRow icon="download" title="Export my data" detail="Invoices, saved details and bills as JSON" onPress={() => void exportData()} />
        <Divider inset={64} />
        <ListRow icon="user-x" title="Request account deletion" tone="danger" onPress={() => void requestDeletion()} />
      </Card>

      {store.storageError ? <Notice tone="danger" title="Storage problem" body={store.storageError} /> : null}
      {auth.previewMode ? <Button title="Clear preview data" icon="trash-2" variant="danger" onPress={() => void clearPreview()} /> : null}
      <Button title={auth.previewMode ? 'Leave preview' : 'Sign out'} icon="log-out" variant="outline" onPress={() => void signOut()} testID="sign-out" />
      <TextBlock size={11} color={colors.mutedForeground} style={{ textAlign: 'center' }}>Version {Constants.expoConfig?.version ?? '1.0.0'} · {store.config ? `${store.config.authMode} mode` : 'service offline'}</TextBlock>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit business profile" subtitle="Changes apply to new invoices only." footer={<Button title="Save profile" onPress={() => void saveProfile()} />}>
        {form ? (
          <View style={{ paddingHorizontal: 18, gap: 12 }}>
            <Field label="Legal business name" required value={form.name} onChangeText={(value) => setForm({ ...form, name: value })} error={formError.name} autoCapitalize="words" />
            <Field label="Address" value={form.address} onChangeText={(value) => setForm({ ...form, address: value })} multiline />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1.3 }}><SelectField label="State" value={form.state} placeholder="Choose" options={stateOptions} onSelect={(value) => setForm({ ...form, state: value })} /></View>
              <View style={{ flex: 1 }}><Field label="PIN code" value={form.pincode ?? ''} onChangeText={(value) => setForm({ ...form, pincode: value.replace(/\D/g, '').slice(0, 6) })} keyboardType="number-pad" error={formError.pincode} /></View>
            </View>
            <Field label="Phone" value={form.phone} onChangeText={(value) => setForm({ ...form, phone: value })} keyboardType="phone-pad" />
            <Field label="Email" value={form.email} onChangeText={(value) => setForm({ ...form, email: value })} keyboardType="email-address" autoCapitalize="none" error={formError.email} />
          </View>
        ) : null}
      </Sheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8, marginBottom: -4 },
  page: { gap: 14 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatar: { width: 50, height: 50, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
