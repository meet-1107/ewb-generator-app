import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { api, type ServiceConfig } from '@/lib/api';
import { appVersionCode, openPlayStore } from '@/lib/play-store';

/** The latest version code the user already said "Later" to, so the offer is made once per release. */
const OFFERED_KEY = 'ewb-vendor-v1:update-offered';

/**
 * Android app updates set in the admin panel: an app older than the minimum version shows
 * only "Update required" (the Play Store) until it is updated; one older than the latest
 * version is offered the update once. Checked at start and each time the app comes back.
 */
export default function UpdateGate({ children }: { children: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const dialog = useDialog();
  const [update, setUpdate] = useState<ServiceConfig['androidUpdate'] | null>(null);
  const current = appVersionCode();

  const check = useCallback(async () => {
    if (Platform.OS !== 'android' || !current) return;
    try {
      const config = await api.config();
      setUpdate(config.androidUpdate ?? null);
      const latest = config.androidUpdate?.latestVersionCode ?? 0;
      if (current >= (config.androidUpdate?.minVersionCode ?? 0) && latest > current) {
        const offered = Number(await AsyncStorage.getItem(OFFERED_KEY).catch(() => null)) || 0;
        if (offered >= latest) return;
        await AsyncStorage.setItem(OFFERED_KEY, String(latest)).catch(() => undefined);
        const yes = await dialog.confirm({ title: 'Update available', message: config.androidUpdate?.message || 'A new version of E-Way Easy is on the Play Store, with fixes and improvements.', confirmLabel: 'Update', cancelLabel: 'Later', icon: 'download' });
        if (yes) await openPlayStore(config.androidUpdate?.storeUrl).catch(() => undefined);
      }
    } catch {
      // Offline or the server is busy: keep working; the next start checks again.
    }
  }, [current, dialog]);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => subscription.remove();
  }, [check]);

  if (!update || !current || current >= update.minVersionCode) return <>{children}</>;
  return (
    <View style={[styles.page, { backgroundColor: colors.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={[styles.mark, { backgroundColor: colors.accent }]}><Feather name="download" size={30} color={colors.primary} /></View>
      <TextBlock size={24} weight="bold" style={styles.center}>Update required</TextBlock>
      <TextBlock size={15} color={colors.mutedForeground} style={[styles.center, { lineHeight: 22 }]}>
        {update.message || 'This version of E-Way Easy is no longer supported. Update from the Play Store to keep making invoices and e-way bills. Your data stays safe in your account.'}
      </TextBlock>
      <Button title="Update now" icon="external-link" onPress={() => void openPlayStore(update.storeUrl).catch(() => undefined)} style={{ alignSelf: 'stretch' }} testID="update-now" />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 28 },
  mark: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
