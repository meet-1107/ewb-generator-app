import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Field, Heading, Notice, TextBlock } from '@/components/AppUI';
import { useAppStore } from '@/state/app-store';
import { useAuth } from '@/state/auth';
import { useColors } from '@/hooks/useColors';
import type { Business } from '@/lib/domain';

export default function BusinessSetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const auth = useAuth();
  const [form, setForm] = useState<Business>({
    name: '',
    gstin: '',
    state: '',
    address: '',
    phone: '',
    email: auth.user?.email ?? '',
    timezone: 'Asia/Kolkata',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  React.useEffect(() => {
    if (!auth.previewMode && !auth.user?.emailVerified) router.replace('/');
  }, [auth.previewMode, auth.user]);
  const change = (key: keyof Business) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) return setError('Enter your legal business name.');
    if (form.gstin.trim() && !/^[0-9A-Z]{15}$/.test(form.gstin.trim().toUpperCase())) {
      return setError('GSTIN should contain 15 letters and numbers. Check the value before saving.');
    }
    setSaving(true);
    setError('');
    try {
      const cleanGstin = form.gstin.trim().toUpperCase();
      await store.saveBusiness({
        ...form,
        gstin: cleanGstin,
        defaultGstin: cleanGstin,
        gstRegistrations: cleanGstin
          ? [{ gstin: cleanGstin, displayName: form.name.trim(), state: form.state, isDefault: true }]
          : [],
      });
      router.replace('/(tabs)');
    } catch {
      setError('Business details could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, {
        paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 20,
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 24,
      }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={70}
    >
      <View style={styles.step}><View style={styles.stepDot} /><TextBlock size={12} weight="semibold" color={colors.primary}>BUSINESS SETUP · 1 OF 1</TextBlock></View>
      <Heading eyebrow="A good place to start" title="Set up your business" subtitle="Add your seller details once. You can review them on every invoice before saving." />
      <Notice title="Use test details in preview" body="This build stores business and invoice drafts on this device. Cloud sync and team access are not connected yet." tone="warning" />
      <Field label="Legal business name *" value={form.name} onChangeText={change('name')} placeholder="As shown on your GST registration" autoCapitalize="words" />
      <Field label="GSTIN" value={form.gstin} onChangeText={change('gstin')} placeholder="15-character GSTIN" autoCapitalize="characters" />
      <Field label="State or union territory" value={form.state} onChangeText={change('state')} placeholder="For example, Maharashtra" autoCapitalize="words" />
      <Field label="Business address" value={form.address} onChangeText={change('address')} placeholder="Street, city, PIN code" multiline autoCapitalize="words" />
      <Field label="Business phone" value={form.phone} onChangeText={change('phone')} placeholder="Mobile number" keyboardType="phone-pad" />
      <Field label="Business email" value={form.email} onChangeText={change('email')} placeholder="billing@business.com" keyboardType="email-address" autoCapitalize="none" />
      {error ? <TextBlock size={13} color={colors.destructive}>{error}</TextBlock> : null}
      <Button title="Save business and continue" icon="arrow-right" onPress={save} loading={saving} />
      <TextBlock size={12} color={colors.mutedForeground} style={styles.caption}>GSTIN format validation is basic and does not verify registration with a government source.</TextBlock>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, gap: 17 },
  step: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#d89043' },
  caption: { textAlign: 'center', lineHeight: 17, marginTop: -3 },
});
