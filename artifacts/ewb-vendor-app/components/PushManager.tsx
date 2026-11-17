import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useDialog } from '@/components/Dialog';
import { pushClient } from '@/lib/push';
import type { PushData } from '@/lib/push-types';
import { useAuth } from '@/state/auth';
import { useAppStore } from '@/state/app-store';
import { clearNotices, openNotice, refreshNotices } from '@/state/notices';

/**
 * Signed in: registers this phone for push, keeps the bell's list fresh, and
 * opens the wallet or the e-way bill when a notification is tapped.
 */
export default function PushManager() {
  const auth = useAuth();
  const store = useAppStore();
  const dialog = useDialog();
  const active = Boolean(auth.signedIn && !auth.previewMode && store.workspaceId);
  const [pending, setPending] = useState<PushData | null>(null);
  const registeredFor = useRef<string | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Taps are caught from the start; they open once the account is ready.
  useEffect(() => pushClient?.onOpen((data) => setPending(data)), []);

  useEffect(() => {
    if (!active || !pending || !store.business) return;
    const target = pending;
    setPending(null);
    void refreshNotices();
    // Leaves the dashboard underneath, so Back returns to it. (Not cleared when `pending`
    // resets just above; only when the manager goes away.)
    openTimer.current = setTimeout(() => openNotice(target), 300);
  }, [active, pending, store.business]);
  useEffect(() => () => { if (openTimer.current) clearTimeout(openTimer.current); }, []);

  useEffect(() => {
    if (!active) {
      clearNotices();
      // Signed out (any way): this phone stops getting the account's notifications.
      // The account screen does this before sign-out; here it covers the other ways.
      if (registeredFor.current && pushClient) void pushClient.unregister().catch(() => undefined);
      registeredFor.current = null;
      return;
    }
    void refreshNotices();
    if (pushClient && registeredFor.current !== store.workspaceId) {
      registeredFor.current = store.workspaceId;
      void pushClient.register().catch(() => {
        registeredFor.current = null;
      });
    }
    const stopRefresh = pushClient?.onTokenRefresh();
    const stopForeground = pushClient?.onForeground((title) => {
      void refreshNotices();
      if (title) dialog.toast(title, 'success');
      if (title.startsWith('Payment') || title.includes('credit')) void store.refreshWallet();
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshNotices();
    });
    return () => {
      stopRefresh?.();
      stopForeground?.();
      appState.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, store.workspaceId]);

  return null;
}
