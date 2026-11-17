import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAppStore } from '@/state/app-store';

/** Team replies not read yet, checked whenever `active` turns true (the left panel opens). */
export function useSupportUnread(active: boolean) {
  const [unread, setUnread] = useState(0);
  const ready = Boolean(useAppStore().workspaceId);
  useEffect(() => {
    if (!active || !ready) return;
    let live = true;
    api.supportChat().then((chat) => { if (live) setUnread(chat.unread); }).catch(() => undefined);
    return () => { live = false; };
  }, [active, ready]);
  return unread;
}
