import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Card, Field, Heading, Notice, ProgressSteps, SelectField, StatusPill, TextBlock } from '@/components/AppUI';
import { useAppStore } from '@/state/app-store';
import { useAuth } from '@/state/auth';
import { useColors } from '@/hooks/useColors';
import { useGstinVerify } from '@/hooks/useGstinVerify';
import { financialYearPrefix, gstinProblem, STATES, stateForGstin, type Business } from '@/lib/domain';

const stateOptions = STATES.map((state) => ({ value: state.name, label: state.name, detail: `State code ${state.code}` }));

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
    pincode: '',
    phone: '',
    email: auth.user?.email ?? '',
    timezone: 'Asia/Kolkata',
    invoicePrefix: financialYearPrefix(),
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Business, string>>>({});
  const [saving, setSaving] = useState(false);
  const { verify, verifying } = useGstinVerify();
  const canVerify = store.config?.gstinVerification !== false;

  const verifyGstin = async () => {
    const details = await verify(form.gstin);
    if (!details) return;
    setForm((current) => ({
      ...current,
      name: details.legalName || current.name,
      address: details.address || current.address,
      pincode: details.pincode || current.pincode,
      state: details.state || current.state,
      verified: { legalName: details.legalName, tradeName: details.tradeName, status: details.status, verifiedAt: details.verifiedAt, city: details.city },
    }));
    setErrors({});
  };

  useEffect(() => {
    if (!auth.signedIn) router.replace('/');
  }, [auth.signedIn]);

  const change = (key: keyof Business) => (value: string) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      // A different GSTIN needs a fresh verification.
      if (key === 'gstin' && value.toUpperCase() !== current.gstin.toUpperCase()) next.verified = undefined;
      // A valid GSTIN tells us the registered state.
      if (key === 'gstin' && value.length === 15 && !gstinProblem(value)) next.state = stateForGstin(value.toUpperCase())?.name ?? next.state;
      return next;
    });
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const save = async () => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = 'Enter your legal business name.';
    const gstin = form.gstin.trim().toUpperCase();
    if (!gstin) next.gstin = 'GSTIN is needed to prepare e-way bills.';
    else if (gstinProblem(gstin)) next.gstin = gstinProblem(gstin)!;
    if (!form.state) next.state = 'Choose your state.';
    else if (gstin && !next.gstin && stateForGstin(gstin)?.name !== form.state) next.state = `This GSTIN is registered in ${stateForGstin(gstin)?.name}.`;
    if (form.pincode && !/^[1-9]\d{5}$/.test(form.pincode)) next.pincode = 'PIN code must be 6 digits.';
    if (form.phone && !/^[6-9]\d{9}$/.test(form.phone.replace(/\D/g, '').slice(-10))) next.phone = 'Enter a 10-digit mobile number.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await store.saveBusiness({
        ...form,
        name: form.name.trim(),
        gstin,
        defaultGstin: gstin,
        gstRegistrations: [{ gstin, displayName: form.name.trim(), state: form.state, isDefault: true }],
      });
      await store.setActiveGstin(gstin);
      router.replace('/(tabs)');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, {
        paddingTop: (Platform.OS === 'web' ? 40 : insets.top) + 16,
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 24,
      }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={70}
    >
      <ProgressSteps steps={['Account', 'Business', 'Start']} current={1} />
      <Heading eyebrow="Almost there" title="Set up your business" subtitle="Add your seller details once — every new invoice starts with them." />
      {auth.previewMode ? <Notice title="Preview workspace" body="Use test details. Drafts sync to the sandbox service only and nothing is sent to the government portal." tone="warning" /> : null}
      <Card>
        <TextBlock size={15} weight="semibold">Registration</TextBlock>
        <Field label="Legal business name" required value={form.name} onChangeText={change('name')} placeholder="As shown on your GST registration" autoCapitalize="words" error={errors.name} testID="setup-name" />
        <Field
          label="GSTIN"
          required
          value={form.gstin}
          onChangeText={(value) => change('gstin')(value.toUpperCase().replace(/\s/g, ''))}
          placeholder="27AAPFU0939F1ZV"
          autoCapitalize="characters"
          maxLength={15}
          error={errors.gstin}
          hint={form.verified ? undefined : canVerify ? 'Tap Verify to fetch your registered name and address.' : 'We check the format and check digit.'}
          right={canVerify && form.gstin.length === 15 && !form.verified ? <Button title="Verify" size="sm" variant="outline" onPress={() => void verifyGstin()} loading={verifying} testID="setup-verify" /> : undefined}
          testID="setup-gstin"
        />
        {form.verified ? (
          <View style={styles.verified}>
            <StatusPill label={`Verified · ${form.verified.status}`} tone={form.verified.status.toLowerCase() === 'active' ? 'green' : 'red'} icon="check" />
            {form.verified.tradeName && form.verified.tradeName !== form.verified.legalName ? <TextBlock size={12} color={colors.mutedForeground}>Trade name: {form.verified.tradeName}</TextBlock> : null}
          </View>
        ) : null}
        <SelectField label="State / union territory" required value={form.state} placeholder="Choose state" options={stateOptions} onSelect={change('state')} error={errors.state} />
      </Card>
      <Card>
        <TextBlock size={15} weight="semibold">Address & contact</TextBlock>
        <Field label="Business address" value={form.address} onChangeText={change('address')} placeholder="Building, street, city" multiline autoCapitalize="words" />
        <Field label="PIN code" value={form.pincode} onChangeText={(value) => change('pincode')(value.replace(/\D/g, '').slice(0, 6))} placeholder="411001" keyboardType="number-pad" error={errors.pincode} />
        <Field label="Mobile number" value={form.phone} onChangeText={change('phone')} placeholder="98765 43210" keyboardType="phone-pad" error={errors.phone} />
        <Field label="Billing email" value={form.email} onChangeText={change('email')} placeholder="billing@business.com" keyboardType="email-address" autoCapitalize="none" error={errors.email} />
      </Card>
      <Card>
        <TextBlock size={15} weight="semibold">Invoice numbering</TextBlock>
        <Field label="Invoice number prefix" value={form.invoicePrefix} onChangeText={change('invoicePrefix')} placeholder="INV/26-27/" autoCapitalize="characters" maxLength={12} hint={`Next invoice will be ${form.invoicePrefix || 'INV-'}001. You can change any number before saving.`} />
      </Card>
      <Button title="Save and continue" icon="arrow-right" onPress={save} loading={saving} testID="setup-save" />
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' },
  verified: { gap: 6, alignItems: 'flex-start' },
});
