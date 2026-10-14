import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Checkbox, Notice, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { api, ApiError } from '@/lib/api';
import { consentKey, LEGAL_VERSION, PENDING_CONSENT_KEY, PRIVACY_URL, TERMS_URL } from '@/lib/legal';
import { useAppStore } from '@/state/app-store';
import { useAuth } from '@/state/auth';

type State = 'checking' | 'ok' | 'required';

/**
 * A signed-in account must accept the current Terms & Conditions and Privacy Policy
 * before using the app (DPDP Act 2023 / IT Act 2000). Accounts that ticked the box at
 * sign-up are recorded silently; Google sign-ups and existing accounts are asked once,
 * and again whenever LEGAL_VERSION changes.
 */
export default function ConsentGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const store = useAppStore();
  const workspaceId = auth.signedIn && !auth.previewMode ? store.workspaceId : null;
  const colors = useColors();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setState('checking');
    (async () => {
      const key = consentKey(workspaceId);
      if ((await AsyncStorage.getItem(key).catch(() => null)) === LEGAL_VERSION) return 'ok' as const;
      // Ticked at sign-up (before the account existed): record it now.
      const pending = await AsyncStorage.getItem(PENDING_CONSENT_KEY).catch(() => null);
      try {
        if (pending === LEGAL_VERSION) {
          await api.acceptConsent(LEGAL_VERSION, 'signup');
          await AsyncStorage.removeItem(PENDING_CONSENT_KEY).catch(() => undefined);
        } else if ((await api.consent()).required) {
          return 'required' as const;
        }
        await AsyncStorage.setItem(key, LEGAL_VERSION).catch(() => undefined);
        return 'ok' as const;
      } catch {
        // Offline with no record on this device: ask (the button retries the server).
        return 'required' as const;
      }
    })().then((next) => active && setState(next));
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const accepted = useCallback(async () => {
    if (workspaceId) await AsyncStorage.setItem(consentKey(workspaceId), LEGAL_VERSION).catch(() => undefined);
    setState('ok');
  }, [workspaceId]);

  // The app stays mounted underneath (navigation keeps working); the gate covers it.
  const gate = !workspaceId || state === 'ok' ? null
    : state === 'checking' ? <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>
    : <ConsentScreen onAccepted={accepted} onSignOut={() => void auth.signOut()} />;
  return (
    <View style={{ flex: 1 }}>
      {children}
      {gate ? <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>{gate}</View> : null}
    </View>
  );
}

function ConsentScreen({ onAccepted, onSignOut }: { onAccepted: () => void; onSignOut: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const agree = async () => {
    setBusy(true);
    setError('');
    try {
      await api.acceptConsent(LEGAL_VERSION, 'prompt');
      onAccepted();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save your consent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={[styles.body, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}>
      <Image source={require('@/assets/images/icon.png')} style={styles.logo} />
      <View style={{ gap: 6 }}>
        <TextBlock size={24} weight="bold">Before you continue</TextBlock>
        <TextBlock size={14} color={colors.mutedForeground} style={{ lineHeight: 21 }}>Please read and accept our Terms & Conditions and Privacy Policy to use E-Way Easy.</TextBlock>
      </View>
      <Card style={{ gap: 10 }}>
        {[
          'We use your business, invoice and e-way bill details only to run the app for you.',
          'Your e-way bill portal login is stored encrypted and used only to file bills you ask for.',
          'Payments are handled by Razorpay; we never see your card or UPI PIN.',
          'You can export your data or ask us to delete your account at any time.',
        ].map((line) => (
          <View key={line} style={styles.point}>
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <TextBlock size={13} style={{ flex: 1, lineHeight: 19 }}>{line}</TextBlock>
          </View>
        ))}
      </Card>
      <View style={{ gap: 10 }}>
        <Button title="Read Terms & Conditions" icon="file-text" variant="outline" onPress={() => void Linking.openURL(TERMS_URL)} />
        <Button title="Read Privacy Policy" icon="shield" variant="outline" onPress={() => void Linking.openURL(PRIVACY_URL)} />
      </View>
      <Checkbox checked={agreed} onToggle={() => setAgreed((value) => !value)} label="I have read and agree to the Terms & Conditions and the Privacy Policy." testID="consent-check" />
      {error ? <Notice tone="warning" title="Not saved" body={error} /> : null}
      <Button title="Agree and continue" icon="check" onPress={() => void agree()} disabled={!agreed || busy} loading={busy} testID="consent-agree" />
      <Button title="Sign out" variant="ghost" onPress={onSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center' },
  logo: { width: 56, height: 56, borderRadius: 14 },
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 },
});
