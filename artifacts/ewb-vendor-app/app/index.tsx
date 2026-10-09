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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Button, Field, Notice, TextBlock } from '@/components/AppUI';
import { useAuth } from '@/state/auth';
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
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (auth.isLoading || !store.isHydrated) return;
    if (auth.previewMode || auth.user?.emailVerified) {
      router.replace(store.business ? '/(tabs)' : '/setup');
    }
  }, [auth.isLoading, auth.previewMode, auth.user, store.business, store.isHydrated]);

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
      setMessage(error instanceof Error ? error.message : 'We could not complete that request. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (auth.isLoading) {
    return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  const title = mode === 'create' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back';
  const action = mode === 'create' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in';

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
        <View style={styles.brandMark}><Image source={require('@/assets/images/icon.png')} style={styles.logo} /></View>
        <TextBlock size={14} weight="bold" color={colors.primary}>MARG / EWB DESK</TextBlock>
      </View>
      <View style={styles.hero}>
        <TextBlock size={36} weight="bold" style={styles.heroTitle}>{title}</TextBlock>
        <TextBlock color={colors.mutedForeground} style={styles.heroBody}>Create and manage e-way bills from your invoices.</TextBlock>
      </View>
      {!auth.firebaseConfigured ? (
        <>
          <Notice
            title="Firebase setup required"
            body="Sign-in and account creation are disabled until this app is connected to your Firebase project. Use preview mode with test details while building."
            tone="warning"
          />
          <TextBlock size={12} color={colors.mutedForeground}>Email and password sign-in are supported. Phone sign-in and OTP are not configured.</TextBlock>
        </>
      ) : null}
      {auth.user && !auth.user.emailVerified ? (
        <Notice title="Verify your email" body="Open the verification email we sent before signing in." />
      ) : null}
      <View style={styles.form}>
        {mode === 'create' ? <Field label="Your name" value={name} onChangeText={setName} placeholder="Full name" autoCapitalize="words" /> : null}
        <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@business.com" keyboardType="email-address" autoCapitalize="none" />
        {mode !== 'reset' ? <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry /> : null}
        {message ? <Notice title="A note about your request" body={message} tone={message.toLowerCase().includes('could not') || message.toLowerCase().includes('enter') ? 'warning' : 'info'} /> : null}
        <Button title={action} onPress={submit} loading={busy} disabled={!auth.firebaseConfigured} testID="auth-submit" />
      </View>
      <View style={styles.links}>
        {mode === 'sign-in' ? (
          <>
            <Pressable onPress={() => { setMode('reset'); setMessage(''); }}><TextBlock color={colors.primary} weight="semibold">Forgot password?</TextBlock></Pressable>
            <Pressable onPress={() => { setMode('create'); setMessage(''); }}><TextBlock color={colors.primary} weight="semibold">Create account</TextBlock></Pressable>
          </>
        ) : (
          <Pressable onPress={() => { setMode('sign-in'); setMessage(''); }}><TextBlock color={colors.primary} weight="semibold">Back to sign in</TextBlock></Pressable>
        )}
      </View>
      <View style={styles.footer}>
        <TextBlock size={12} color={colors.mutedForeground}>By continuing, you agree to our Terms and Privacy Policy.</TextBlock>
        {__DEV__ ? (
          <View style={styles.preview}>
            <TextBlock size={12} color={colors.mutedForeground}>Build a business workflow without entering credentials.</TextBlock>
            <Button title="Open local preview" icon="eye" secondary onPress={auth.enterPreview} testID="preview-entry" />
          </View>
        ) : null}
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, gap: 24 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topline: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 6 },
  brandMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#175b42', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logo: { width: 36, height: 36 },
  hero: { gap: 8, marginTop: 20 },
  heroTitle: { lineHeight: 42, letterSpacing: -1.2 },
  heroBody: { fontSize: 16, lineHeight: 23, maxWidth: 300 },
  form: { gap: 16 },
  links: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 24 },
  footer: { marginTop: 'auto', gap: 18, paddingTop: 16 },
  preview: { gap: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d9ddd4', paddingTop: 17 },
});
