import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { useAppStore } from '@/state/app-store';

/**
 * Free trial credits to offer, or 0. Offered only while no portal login is saved: the server
 * can still offer them when a saved login brought none (GSTIN already used, or not checked).
 */
export function useWelcomeCredits() {
  const store = useAppStore();
  const offered = store.wallet?.welcomeCredits ?? 0;
  const [hasPortalLogin, setHasPortalLogin] = useState<boolean | null>(null);
  useFocusEffect(useCallback(() => {
    if (!offered || !store.workspaceId) return;
    let active = true;
    api.ewbCredentials().then((result) => active && setHasPortalLogin(result.credentials.length > 0)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [offered, store.workspaceId]));
  return hasPortalLogin === false ? offered : 0;
}
