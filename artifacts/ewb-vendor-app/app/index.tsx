import React, { useEffect, useState } from 'react';
import {
  Image,
  Keyboard,
  Pressable,
  Platform,
  StyleSheet,
  View,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Card, Field, Notice, TextBlock } from '@/components/AppUI';
import { useAuth } from '@/state/auth';
import { authErrorMessage } from '@/lib/auth-types';
import { useAppStore } from '@/state/app-store';
import { useColors } from '@/hooks/useColors';

type Mode = 'sign-in' | 'create' | 'reset';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const store = useAppStore();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (auth.isLoading || !store.isHydrated) return;
    if (auth.signedIn) {
      router.replace(store.business ? '/(tabs)' : '/setup');
    }
  }, [auth.isLoading, auth.signedIn, store.business, store.isHydrated]);

  // Google sign-in also creates the account on first use; the effect above then navigates.
  const continueWithGoogle = async () => {
    Keyboard.dismiss();
    setGoogleBusy(true);
    setMessage('');
    try {
      await auth.signInWithGoogle();
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setGoogleBusy(false);
    }
  };

  const submit = async () => {
    Keyboard.dismiss();
    if (!email.trim()) return setMessage('Enter the email address for your account.');
    if (mode === 'create' && !name.trim()) return setMessage('Enter your name to create an account.');
    if (mode !== 'reset' && password.length < 8) return setMessage('Enter a password with at least 8 characters.');
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'sign-in') {
        await auth.signIn(email, password);
      } else if (mode === 'create') {
        await auth.createAccount(name, email, password);
        setMessage('Account created. Check your inbox to verify your email, then sign in.');
        setMode('sign-in');
        setPassword('');
      } else {
        await auth.resetPassword(email);
        setMessage('If an account exists for this email, a password reset link has been sent.');
        setMode('sign-in');
      }
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (auth.isLoading) {
    return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  const title = mode === 'create' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back';
  const action = mode === 'create' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in';
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
          <TextBlock size={14} weight="bold" color={colors.primary}>MARG / EWB DESK</TextBlock>
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
      {auth.user && !auth.user.verified ? (
        <Notice title="Verify your email" body="Open the verification email we sent before signing in." />
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
            <TextBlock size={19} weight="bold">{title}</TextBlock>
            <TextBlock size={12} color={colors.mutedForeground}>{mode === 'reset' ? "We'll email you a link to choose a new password." : 'Use your Google account, or your email and password.'}</TextBlock>
          </View>
          {mode !== 'reset' ? (
            <>
              <Button title="Continue with Google" icon="log-in" variant="outline" onPress={() => void continueWithGoogle()} loading={googleBusy} disabled={!auth.firebaseConfigured || busy} testID="auth-google" />
              <View style={styles.divider}>
                <View style={[styles.rule, { backgroundColor: colors.border }]} />
                <TextBlock size={11} weight="medium" color={colors.mutedForeground}>OR WITH EMAIL</TextBlock>
                <View style={[styles.rule, { backgroundColor: colors.border }]} />
              </View>
            </>
          ) : null}
          <View style={styles.form}>
            {mode === 'create' ? <Field label="Your name" value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="words" /> : null}
            <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@business.com" keyboardType="email-address" autoCapitalize="none" />
            {mode !== 'reset' ? <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry /> : null}
            {message ? <Notice title="A note about your request" body={message} tone={/could not|enter|incorrect|not valid|too many|offline|not enabled|not set up|blocked|missing|disabled|already/i.test(message) ? 'warning' : 'info'} /> : null}
            <Button title={action} onPress={submit} loading={busy} disabled={!auth.firebaseConfigured || googleBusy} testID="auth-submit" />
          </View>
          {auth.firebaseConfigured ? <View style={styles.links}>
            {mode === 'sign-in' ? (
              <>
                <Pressable onPress={() => { setMode('reset'); setMessage(''); }}><TextBlock color={colors.primary} weight="semibold">Forgot password?</TextBlock></Pressable>
                <Pressable onPress={() => { setMode('create'); setMessage(''); }}><TextBlock color={colors.primary} weight="semibold">Create account</TextBlock></Pressable>
              </>
            ) : (
              <Pressable onPress={() => { setMode('sign-in'); setMessage(''); }}><TextBlock color={colors.primary} weight="semibold">Back to sign in</TextBlock></Pressable>
            )}
          </View> : null}
        </Card>
      )}
      <View style={styles.footer}>
        {auth.firebaseConfigured ? <TextBlock size={11} color={colors.mutedForeground}>By continuing, you agree to our Terms and Privacy Policy.</TextBlock> : null}
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
  footer: { marginTop: 'auto', paddingTop: 4 },
});
