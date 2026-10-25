import { useCallback, useEffect, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDialog } from '@/components/Dialog';
import { api } from '@/lib/api';
import { appVersionCode, openPlayStore } from '@/lib/play-store';

/** The latest version code the user already said "Later" to, so the alert comes once per release. */
const OFFERED_KEY = 'ewb-vendor-v1:update-offered';

/**
 * Android app updates set in the admin panel: when the Play Store has a newer version than
 * this one, the user is told once per release (Update opens the Play Store, Later keeps
 * working). Updating is never forced. Checked at start and each time the app comes back.
 */
export default function UpdateGate({ children }: { children: ReactNode }) {
  const dialog = useDialog();
  const current = appVersionCode();

  const check = useCallback(async () => {
    if (Platform.OS !== 'android' || !current) return;
    try {
      const update = (await api.config()).androidUpdate;
      // Either setting from the admin panel names a newer release.
      const latest = Math.max(update?.latestVersionCode ?? 0, update?.minVersionCode ?? 0);
      if (!update || latest <= current) return;
      const offered = Number(await AsyncStorage.getItem(OFFERED_KEY).catch(() => null)) || 0;
      if (offered >= latest) return;
      await AsyncStorage.setItem(OFFERED_KEY, String(latest)).catch(() => undefined);
      const yes = await dialog.confirm({ title: 'New update available', message: update.message || 'A new version of E-Way Easy is on the Play Store, with fixes and improvements.', confirmLabel: 'Update', cancelLabel: 'Later', icon: 'download' });
      if (yes) await openPlayStore(update.storeUrl).catch(() => undefined);
    } catch {
      // Offline or the server is busy: keep working; the next start checks again.
    }
  }, [current, dialog]);

  useEffect(() => {
    void check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => subscription.remove();
  }, [check]);

  return <>{children}</>;
}
