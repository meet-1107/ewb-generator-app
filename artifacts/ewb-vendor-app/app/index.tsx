import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  Pressable,
  Platform,
  StyleSheet,
  View,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Card, Checkbox, Field, Notice, TextBlock } from '@/components/AppUI';
import { LEGAL_VERSION, PENDING_CONSENT_KEY, PRIVACY_URL, TERMS_URL } from '@/lib/legal';
import { useAuth } from '@/state/auth';
import { ApiError } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-types';
import { useAppStore } from '@/state/app-store';
import { useColors } from '@/hooks/useColors';

type Mode = 'sign-in' | 'register' | 'code' | 'reset';
const CODE_PATTERN = /^\d{6}$/;

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const store = useAppStore();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  /** Terms & Privacy Policy accepted at sign-up (required to create an account). */
  const [agreed, setAgreed] = useState(false);
  const AGREE_FIRST = 'Tick the box to agree to the Terms & Conditions and Privacy Policy.';
  // Recorded on the server by ConsentGate once the new account is signed in.
  const rememberConsent = () => AsyncStorage.setItem(PENDING_CONSENT_KEY, LEGAL_VERSION).catch(() => undefined);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'warning' | 'success' } | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  // Session-aware routing: a restored or new verified session goes straight to the app.
  useEffect(() => {
    if (auth.isLoading || !store.isHydrated) return;
    // Signing in again (sign-out cleared this phone): wait for the account's details
    // from the server, so an existing business is never asked to set up again.
    if (auth.signedIn && (store.business || store.accountLoaded)) {
      router.replace(store.business ? '/(tabs)' : '/setup');
    }
  }, [auth.isLoading, auth.signedIn, store.business, store.accountLoaded, store.isHydrated]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const go = (next: Mode, note: typeof message = null) => {
    setMode(next);
    setMessage(note);
    setPending(false);
    if (next !== 'code') setCode('');
  };
  const warn = (text: string) => setMessage({ text, tone: 'warning' });

  /** Runs one auth step at a time; extra taps while it runs are ignored. */
  const run = async (step: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true;
    Keyboard.dismiss();
    setBusy(true);
    setMessage(null);
    try {
      await step();
    } catch (error) {
      const codeName = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (codeName === 'auth/pending-registration') setPending(true);
      warn(error instanceof ApiError ? error.message : authErrorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  // Google sign-in also creates the account on first use; the routing effect then opens the app.
  const continueWithGoogle = async () => {
    Keyboard.dismiss();
    // Creating an account (this screen) needs the box; signing in asks after sign-in if needed.
    if (mode === 'register') {
      if (!agreed) return warn(AGREE_FIRST);
      await rememberConsent();
    }
    setGoogleBusy(true);
    setMessage(null);
    try {
      await auth.signInWithGoogle();
    } catch (error) {
      warn(authErrorMessage(error));
    } finally {
      setGoogleBusy(false);
    }
  };

  const validEmail = () => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const signIn = () => run(async () => {
    if (!validEmail()) return warn('Enter the email address for your account.');
    if (!password) return warn('Enter your password.');
    await auth.signIn(email, password);
  });

  const sendCode = (resend = false) => run(async () => {
    if (!validEmail()) return warn('Enter a valid email address.');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return warn('Use at least 8 characters with letters and numbers.');
    if (!agreed) return warn(AGREE_FIRST);
    const cooldown = await auth.sendRegistrationCode(email);
    setResendIn(cooldown);
    setMode('code');
    setMessage({ text: resend ? 'A new code is on its way.' : `We sent a 6-digit code to ${email.trim().toLowerCase()}. It expires in 5 minutes.`, tone: 'info' });
  });

  const verifyCode = () => run(async () => {
    if (!CODE_PATTERN.test(code.trim())) return warn('Enter the 6-digit code from the email.');
    await auth.completeRegistration(email, password, code);
    await rememberConsent();
    setPassword('');
    go('sign-in', { text: 'Account created and email verified. Sign in to continue.', tone: 'success' });
  });

  const reset = () => run(async () => {
    if (!validEmail()) return warn('Enter the email address for your account.');
    await auth.resetPassword(email);
    go('sign-in', { text: 'If an account exists for this email, a password reset link has been sent.', tone: 'info' });
  });

  // An unfinished registration (signed in but unverified) is sent back to the code step.
  const finishPending = async () => {
    if (auth.user?.email) setEmail(auth.user.email);
    await auth.signOut().catch(() => undefined);
    go('register', { text: 'Enter your password again and we will email you a new code.', tone: 'info' });
  };

  if (auth.isLoading) {
    return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (auth.signedIn && store.isHydrated && !store.business && !store.accountLoaded) {
    const failed = store.syncState === 'error' || store.syncState === 'offline';
    return (
      <View style={[styles.loading, { backgroundColor: colors.background, gap: 14, padding: 24 }]}>
        {failed ? null : <ActivityIndicator color={colors.primary} />}
        <TextBlock size={15} weight="semibold" style={{ textAlign: 'center' }}>{failed ? 'Could not load your account' : 'Loading your account…'}</TextBlock>
        {failed ? (
          <>
            <TextBlock size={13} color={colors.mutedForeground} style={{ textAlign: 'center' }}>Check your internet connection. Your business details are safe in your account.</TextBlock>
            <Button title="Try again" icon="refresh-cw" onPress={() => void store.syncNow()} testID="account-retry" />
            <Button title="Sign out" variant="ghost" onPress={() => void auth.signOut()} />
          </>
        ) : null}
      </View>
    );
  }

  const title = { 'sign-in': 'Welcome back', register: 'Create your account', code: 'Verify your email', reset: 'Reset your password' }[mode];
  const subtitle = {
    'sign-in': 'Sign in to continue to your account',
    register: "Enter your email and choose a password. We'll email you a 6-digit code.",
    code: `Enter the code we sent to ${email.trim().toLowerCase()}`,
    reset: "We'll email you a link to choose a new password.",
  }[mode];
  const action = { 'sign-in': 'Sign in', register: 'Send verification code', code: 'Verify and create account', reset: 'Send reset link' }[mode];
  const primary = () => (mode === 'sign-in' ? signIn() : mode === 'register' ? sendCode() : mode === 'code' ? verifyCode() : reset());
  const localPreview = !auth.firebaseConfigured && __DEV__;

  return (
    <KeyboardAwareScrollViewCompat
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, {
        paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 20,
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 24,
      }]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={70}
    >
      <View style={styles.topline}>
        <View style={[styles.brandMark, { backgroundColor: colors.primary }]}><Image source={require('@/assets/images/icon.png')} style={styles.logo} /></View>
        <View style={{ gap: 2 }}>
          <TextBlock size={17} weight="bold" color={colors.primary}>E-way Easy</TextBlock>
          <TextBlock size={10} weight="medium" color={colors.mutedForeground}>INVOICE TO MOVEMENT</TextBlock>
        </View>
      </View>
      <LinearGradient colors={[colors.heroStart, colors.heroEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
        <View style={styles.heroTop}>
          <View style={[styles.heroBadge, { backgroundColor: colors.heroDecoration }]}>
            <Feather name="truck" size={14} color={colors.warmAccent} />
            <TextBlock size={10} weight="bold" color={colors.heroMuted}>THE EWB WORKSPACE</TextBlock>
          </View>
          <View style={[styles.heroOrbit, { borderColor: colors.heroDecoration }]} />
        </View>
        <TextBlock size={25} weight="bold" color={colors.heroText} style={styles.heroTitle}>Paperwork that keeps work moving.</TextBlock>
        <TextBlock size={13} color={colors.heroMuted} style={styles.heroBody}>Create an invoice, review the journey, and keep each next step clear.</TextBlock>
        <View style={styles.heroSteps}>
          {['01  INVOICE', '02  REVIEW', '03  RECORD'].map((step, index) => (
            <View key={step} style={[styles.heroStep, { borderColor: colors.heroDecoration }]}>
              <TextBlock size={9} weight="bold" color={index === 0 ? colors.warmAccent : colors.heroMuted}>{step}</TextBlock>
            </View>
          ))}
        </View>
      </LinearGradient>
      {auth.sessionExpired && !auth.user && mode === 'sign-in' && !message ? (
        <Notice title="Please sign in again" body="Your password or account changed, so this device was signed out." tone="info" />
      ) : null}
      {auth.user && !auth.user.verified && mode === 'sign-in' ? (
        <Notice title="Finish creating your account" body="This account's email is not verified yet." action="Verify email" onAction={() => void finishPending()} tone="warning" />
      ) : null}
      {localPreview ? (
        <>
          <Card style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <View style={[styles.previewIcon, { backgroundColor: colors.accent }]}><Feather name="layers" size={18} color={colors.primary} /></View>
              <View style={{ flex: 1, gap: 3 }}>
                <TextBlock size={17} weight="bold">Step into your workspace</TextBlock>
                <TextBlock size={12} color={colors.mutedForeground}>Explore the invoice flow before connecting an account.</TextBlock>
              </View>
            </View>
            <Button title="Open local preview" icon="arrow-right" onPress={auth.enterPreview} testID="preview-entry" />
            <View style={styles.previewFoot}>
              <Feather name="shield" size={14} color={colors.warningForeground} />
              <TextBlock size={11} color={colors.mutedForeground} style={{ flex: 1, lineHeight: 16 }}>Test details only. Drafts stay on this device; no invoices are submitted.</TextBlock>
            </View>
          </Card>
          <View style={[styles.setupHint, { borderColor: colors.border }]}>
            <Feather name="lock" size={15} color={colors.mutedForeground} />
            <TextBlock size={11} color={colors.mutedForeground} style={{ flex: 1 }}>Connect Firebase to enable Google and email sign-in.</TextBlock>
          </View>
        </>
      ) : (
        <Card style={styles.authCard}>
          {!auth.firebaseConfigured ? <Notice title="Firebase setup required" body="Connect this app to your Firebase project to enable sign-in." tone="warning" /> : null}
          <View style={styles.authTitle}>
            <TextBlock size={20} weight="bold">{title}</TextBlock>
            <TextBlock size={12} color={colors.mutedForeground}>{subtitle}</TextBlock>
          </View>
          <View style={styles.form}>
            {mode === 'code' ? (
              <Field label="6-digit code" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" returnKeyType="done" onSubmitEditing={() => void verifyCode()} testID="auth-code" />
            ) : (
              <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@business.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" returnKeyType="next" testID="auth-email" />
            )}
            {mode === 'sign-in' || mode === 'register' ? (
              <Field label="Password" value={password} onChangeText={setPassword} placeholder={mode === 'register' ? 'At least 8 characters, letters and numbers' : 'Your password'} secureTextEntry autoComplete={mode === 'register' ? 'new-password' : 'current-password'} textContentType={mode === 'register' ? 'newPassword' : 'password'} returnKeyType="go" onSubmitEditing={() => void (mode === 'sign-in' ? signIn() : sendCode())} testID="auth-password" />
            ) : null}
            {mode === 'sign-in' ? (
              <Pressable onPress={() => go('reset')} style={styles.forgot} accessibilityRole="link"><TextBlock size={13} color={colors.primary} weight="semibold">Forgot password?</TextBlock></Pressable>
            ) : null}
            {mode === 'register' ? (
              <View style={{ gap: 6 }}>
                <Checkbox checked={agreed} onToggle={() => setAgreed((value) => !value)} label="I agree to the Terms & Conditions and the Privacy Policy." testID="auth-agree" />
                <View style={styles.legalLinks}>
                  <Pressable onPress={() => void Linking.openURL(TERMS_URL)} accessibilityRole="link" hitSlop={6}><TextBlock size={12} weight="semibold" color={colors.primary}>Read Terms & Conditions</TextBlock></Pressable>
                  <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)} accessibilityRole="link" hitSlop={6}><TextBlock size={12} weight="semibold" color={colors.primary}>Read Privacy Policy</TextBlock></Pressable>
                </View>
              </View>
            ) : null}
            {message ? <Notice title={message.tone === 'success' ? 'Done' : message.tone === 'warning' ? 'Check this' : 'Next step'} body={message.text} tone={message.tone} action={pending ? 'Verify email' : undefined} onAction={pending ? () => go('register', { text: 'Enter your password and we will email you a new code.', tone: 'info' }) : undefined} /> : null}
            <Button title={action} onPress={() => void primary()} loading={busy} disabled={!auth.firebaseConfigured || googleBusy} testID="auth-submit" />
            {mode === 'code' ? (
              <View style={styles.links}>
                <Pressable onPress={() => go('register')}><TextBlock color={colors.primary} weight="semibold">Change email</TextBlock></Pressable>
                <Pressable onPress={() => void sendCode(true)} disabled={busy || resendIn > 0} testID="auth-resend">
                  <TextBlock color={resendIn > 0 ? colors.mutedForeground : colors.primary} weight="semibold">{resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}</TextBlock>
                </Pressable>
              </View>
            ) : null}
          </View>
          {mode === 'sign-in' || mode === 'register' ? (
            <>
              <View style={styles.divider}>
                <View style={[styles.rule, { backgroundColor: colors.border }]} />
                <TextBlock size={11} weight="medium" color={colors.mutedForeground}>or</TextBlock>
                <View style={[styles.rule, { backgroundColor: colors.border }]} />
              </View>
              <Button title="Continue with Google" icon="log-in" variant="outline" onPress={() => void continueWithGoogle()} loading={googleBusy} disabled={!auth.firebaseConfigured || busy} testID="auth-google" />
            </>
          ) : null}
          {auth.firebaseConfigured ? (
            <View style={styles.switchRow}>
              {mode === 'sign-in' ? (
                <>
                  <TextBlock size={13} color={colors.mutedForeground}>Don't have an account?</TextBlock>
                  <Pressable onPress={() => go('register')} testID="auth-create"><TextBlock size={13} color={colors.primary} weight="semibold">Create account</TextBlock></Pressable>
                </>
              ) : (
                <>
                  <TextBlock size={13} color={colors.mutedForeground}>{mode === 'reset' ? 'Remembered it?' : 'Already have an account?'}</TextBlock>
                  <Pressable onPress={() => go('sign-in')} testID="auth-back"><TextBlock size={13} color={colors.primary} weight="semibold">Sign in</TextBlock></Pressable>
                </>
              )}
            </View>
          ) : null}
        </Card>
      )}
      <View style={styles.footer}>
        {auth.firebaseConfigured ? (
          <View style={styles.legalLinks}>
            <Pressable onPress={() => void Linking.openURL(TERMS_URL)} accessibilityRole="link"><TextBlock size={11} color={colors.mutedForeground} style={{ textDecorationLine: 'underline' }}>Terms & Conditions</TextBlock></Pressable>
            <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)} accessibilityRole="link"><TextBlock size={11} color={colors.mutedForeground} style={{ textDecorationLine: 'underline' }}>Privacy Policy</TextBlock></Pressable>
          </View>
        ) : null}
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 22, gap: 18 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topline: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logo: { width: 38, height: 38 },
  heroCard: { minHeight: 208, borderRadius: 24, overflow: 'hidden', padding: 19, justifyContent: 'space-between', gap: 12 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', height: 24 },
  heroBadge: { alignSelf: 'flex-start', height: 24, borderRadius: 99, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroOrbit: { position: 'absolute', top: -42, right: -29, width: 114, height: 114, borderRadius: 57, borderWidth: 1 },
  heroTitle: { lineHeight: 31, letterSpacing: -0.7, maxWidth: 300 },
  heroBody: { lineHeight: 19, maxWidth: 290 },
  heroSteps: { flexDirection: 'row', gap: 6, marginTop: 2 },
  heroStep: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5 },
  previewCard: { gap: 14, padding: 16 },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  previewIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  previewFoot: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  setupHint: { borderWidth: 1, borderRadius: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  authCard: { gap: 17, padding: 17 },
  authTitle: { gap: 5 },
  form: { gap: 14 },
  links: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 24 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  forgot: { alignSelf: 'flex-end', marginTop: -4 },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingLeft: 2 },
  switchRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  footer: { marginTop: 'auto', paddingTop: 4 },
});
