import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Field, Notice, SelectField, TextBlock } from '@/components/AppUI';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { CredentialProgress } from '@/components/CredentialProgress';
import { useDialog } from '@/components/Dialog';
import { GuideImage } from '@/components/GuideImage';
import { EWB_PORTAL_URL } from '@/components/EwbLoginGuide';
import { useColors } from '@/hooks/useColors';
import { credentialError, saveEwbLogin } from '@/lib/ewb-credential';
import { GUIDE_STEPS } from '@/lib/ewb-guide';
import { gstinProblem } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

/** 0 = welcome, 1…GUIDE_STEPS.length = portal steps, then the login form, then done. */
const FORM = GUIDE_STEPS.length + 1;
const DONE = FORM + 1;

/**
 * Onboarding after the business is set up (also from the dashboard and the support
 * chat): how to create the e-way bill portal API login, with marked screenshots,
 * then the login itself. Every step can be skipped.
 */
export default function EwbSetupScreen() {
  const params = useLocalSearchParams<{ first?: string; step?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const dialog = useDialog();
  const first = params.first === '1';
  const [step, setStep] = useState(() => Math.min(Math.max(Number(params.step) || 0, 0), FORM));
  const gstins = useMemo(() => {
    const list = new Set<string>();
    if (store.activeGstin) list.add(store.activeGstin);
    if (store.business?.gstin) list.add(store.business.gstin);
    for (const registration of store.business?.gstRegistrations ?? []) list.add(registration.gstin);
    return [...list].filter((gstin) => !gstinProblem(gstin));
  }, [store.activeGstin, store.business]);
  const [gstin, setGstin] = useState(gstins[0] ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState('');
  const [credits, setCredits] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => { if (!gstin && gstins[0]) setGstin(gstins[0]); }, [gstin, gstins]);

  const go = (next: number) => {
    Animated.timing(fade, { toValue: 0, duration: 90, useNativeDriver: true }).start(() => {
      setStep(next);
      setError('');
      Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    });
  };

  const leave = () => {
    if (first || !router.canGoBack()) router.replace('/(tabs)');
    else router.back();
  };

  const skip = async () => {
    const ok = await dialog.confirm({
      title: 'Skip for now?',
      message: 'You can do this any time from Account → Wallet → E-way bill portal login. It is needed before your first e-way bill.',
      confirmLabel: 'Skip',
      cancelLabel: 'Continue setup',
      icon: 'skip-forward',
    });
    if (ok) leave();
  };

  const save = async () => {
    const user = username.trim();
    if (!gstin) return setError('Add your GSTIN in the business profile first.');
    if (!user) return setError('Enter the API username (the grey part + your 3 letters).');
    if (!password) return setError('Enter the API password.');
    if (password.length > 15) return setError('The portal allows a password of up to 15 characters.');
    setError('');
    setSaving(true);
    setSavedOk(false);
    try {
      const result = await saveEwbLogin(gstin, user, password);
      setSavedOk(true);
      if (result.balance !== undefined) store.setWalletBalance(result.balance);
      void store.refreshWallet();
      setCredits(result.welcomeCredits ?? 0);
      await new Promise((resolve) => setTimeout(resolve, 900));
      setPassword('');
      setError('');
      setStep(DONE);
    } catch (failure) {
      setError(credentialError(failure));
    } finally {
      setSaving(false);
    }
  };

  const guide = step >= 1 && step <= GUIDE_STEPS.length ? GUIDE_STEPS[step - 1]! : null;
  const total = GUIDE_STEPS.length + 1;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Top bar: back, progress, skip */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        {step > 0 && step < DONE && !saving ? (
          <Pressable onPress={() => go(step - 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous step" style={styles.topBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </Pressable>
        ) : <View style={styles.topBtn} />}
        <View style={styles.dots}>
          {step > 0 && step < DONE ? Array.from({ length: total }, (_, index) => (
            <View key={index} style={[styles.dot, { backgroundColor: index < step ? colors.primary : colors.muted, flex: index === step - 1 ? 2 : 1 }]} />
          )) : null}
        </View>
        {step < DONE && !saving ? (
          <Pressable onPress={() => void skip()} hitSlop={10} accessibilityRole="button" testID="ewb-setup-skip">
            <TextBlock size={14} weight="bold" color={colors.primary}>Skip</TextBlock>
          </Pressable>
        ) : <View style={styles.topBtn} />}
      </View>

      <KeyboardAwareScrollViewCompat
        key={step}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fade, gap: 16 }}>
          {step === 0 ? (
            <>
              <View style={[styles.hero, { backgroundColor: colors.primary }]}>
                <View style={styles.heroIcons}>
                  <View style={[styles.heroBadge, { backgroundColor: 'rgba(255,255,255,0.14)' }]}><Feather name="globe" size={26} color="#fff" /></View>
                  <Feather name="arrow-right" size={20} color="rgba(255,255,255,0.7)" />
                  <View style={[styles.heroBadge, { backgroundColor: 'rgba(255,255,255,0.14)' }]}><Feather name="key" size={26} color="#fff" /></View>
                  <Feather name="arrow-right" size={20} color="rgba(255,255,255,0.7)" />
                  <View style={[styles.heroBadge, { backgroundColor: colors.warmAccent }]}><Feather name="truck" size={26} color="#1b1b1b" /></View>
                </View>
                <TextBlock size={22} weight="bold" color="#fff">Connect the e-way bill portal</TextBlock>
                <TextBlock size={14} color="rgba(255,255,255,0.85)">One-time setup so E-Way Easy can generate e-way bills for you.</TextBlock>
              </View>
              <View style={{ gap: 12 }}>
                {[
                  { icon: 'clock' as const, text: 'Takes about 5 minutes' },
                  { icon: 'image' as const, text: 'Simple steps with pictures' },
                  { icon: 'gift' as const, text: 'Get 10 free credits when your login is saved' },
                  { icon: 'lock' as const, text: 'Your password is stored encrypted' },
                ].map((item) => (
                  <View key={item.text} style={styles.benefit}>
                    <View style={[styles.benefitIcon, { backgroundColor: colors.accent }]}><Feather name={item.icon} size={18} color={colors.primary} /></View>
                    <TextBlock size={15} weight="semibold" style={{ flex: 1 }}>{item.text}</TextBlock>
                  </View>
                ))}
              </View>
              <Button title="Start setup" icon="play" onPress={() => go(1)} testID="ewb-setup-start" />
              <Button title="I already have an API login" icon="key" variant="outline" onPress={() => go(FORM)} testID="ewb-setup-have" />
            </>
          ) : null}

          {guide ? (
            <>
              <View style={{ gap: 4 }}>
                <TextBlock size={12} weight="bold" color={colors.primary}>STEP {step} OF {total}</TextBlock>
                <TextBlock size={21} weight="bold">{guide.title}</TextBlock>
              </View>
              {guide.image ? <GuideImage source={guide.image} label={guide.title} /> : (
                <View style={[styles.portalCard, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                  <Feather name="monitor" size={34} color={colors.primary} />
                  <TextBlock size={14} weight="bold" color={colors.primary}>ewaybillgst.gov.in</TextBlock>
                </View>
              )}
              <View style={[styles.points, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {guide.points.map((point, index) => (
                  <View key={point} style={styles.point}>
                    <View style={[styles.num, { backgroundColor: colors.primary }]}><TextBlock size={12} weight="bold" color={colors.primaryForeground}>{index + 1}</TextBlock></View>
                    <TextBlock size={15} style={{ flex: 1 }}>{point}</TextBlock>
                  </View>
                ))}
              </View>
              {guide.tip ? <Notice tone="info" title="Tip" body={guide.tip} /> : null}
              {step === 1 ? <Button title="Open e-way bill portal" icon="external-link" variant="outline" onPress={() => void Linking.openURL(EWB_PORTAL_URL).catch(() => dialog.toast('Could not open the browser', 'danger'))} testID="ewb-setup-portal" /> : null}
              <Button title={step === GUIDE_STEPS.length ? 'Done — enter API login' : 'Next'} icon={step === GUIDE_STEPS.length ? 'key' : 'arrow-right'} onPress={() => go(step + 1)} testID="ewb-setup-next" />
            </>
          ) : null}

          {step === FORM ? (
            saving ? <CredentialProgress done={savedOk} /> : (
              <>
                <View style={{ gap: 4 }}>
                  <TextBlock size={12} weight="bold" color={colors.primary}>LAST STEP</TextBlock>
                  <TextBlock size={21} weight="bold">Enter your API login</TextBlock>
                  <TextBlock size={13} color={colors.mutedForeground}>The username and password you just created on the portal.</TextBlock>
                </View>
                {gstins.length > 1 ? (
                  <SelectField label="GSTIN" value={gstin} placeholder="Choose GSTIN" options={gstins.map((value) => ({ value, label: value }))} onSelect={setGstin} />
                ) : (
                  <View style={[styles.gstin, { backgroundColor: colors.accent }]}>
                    <Feather name="shield" size={16} color={colors.primary} />
                    <TextBlock size={14} weight="bold" color={colors.primary}>{gstin || 'No GSTIN in your business profile'}</TextBlock>
                  </View>
                )}
                <Field label="API username" required value={username} onChangeText={(value) => { setUsername(value.replace(/\s/g, '')); setError(''); }} autoCapitalize="none" placeholder="e.g. ABC@2020_API_XYZ" testID="ewb-setup-username" />
                <Field label="API password" required value={password} onChangeText={(value) => { setPassword(value); setError(''); }} secureTextEntry maxLength={15} hint="Up to 15 characters · stored encrypted" testID="ewb-setup-password" />
                {error ? <Notice tone="danger" title="Not saved" body={error} /> : null}
                <Button title="Save and check" icon="check-circle" onPress={() => void save()} testID="ewb-setup-save" />
                <Button title="See the steps again" icon="book-open" variant="ghost" onPress={() => go(1)} />
              </>
            )
          ) : null}

          {step === DONE ? (
            <View style={{ alignItems: 'center', gap: 14, paddingTop: 30 }}>
              <View style={[styles.doneRing, { backgroundColor: colors.successBackground }]}>
                <Feather name={credits ? 'gift' : 'check'} size={44} color={colors.successForeground} />
              </View>
              <TextBlock size={24} weight="bold" style={{ textAlign: 'center' }}>{credits ? `${credits} free credits added!` : 'You are all set!'}</TextBlock>
              <TextBlock size={14} color={colors.mutedForeground} style={{ textAlign: 'center' }}>
                {credits ? 'Your portal login is saved. Use the free credits to generate your first e-way bills.' : 'Your portal login is saved. You can generate e-way bills now.'}
              </TextBlock>
              <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
                <Button title="Go to dashboard" icon="home" onPress={leave} testID="ewb-setup-done" />
              </View>
            </View>
          ) : null}
        </Animated.View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  topBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  dots: { flex: 1, flexDirection: 'row', gap: 4 },
  dot: { height: 6, borderRadius: 3 },
  body: { padding: 18, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  hero: { borderRadius: 22, padding: 22, gap: 10 },
  heroIcons: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  heroBadge: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  benefitIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  portalCard: { height: 150, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  points: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  num: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  gstin: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 12 },
  doneRing: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
});
