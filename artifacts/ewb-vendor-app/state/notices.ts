import { useSyncExternalStore } from 'react';
import { router } from 'expo-router';
import { api, type Notice } from '@/lib/api';
import type { PushData } from '@/lib/push-types';

/** The bell's notifications (newest 10 from the server) and the unread count. */
type State = { notices: Notice[]; unread: number; loaded: boolean; loading: boolean; error: string };

let state: State = { notices: [], unread: 0, loaded: false, loading: false, error: '' };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

export function useNotices() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => state);
}

let inFlight: Promise<void> | null = null;

export function refreshNotices() {
  inFlight ??= (async () => {
    set({ loading: true });
    try {
      const list = await api.notifications();
      set({ notices: list.notices, unread: list.unread, loaded: true, error: '' });
    } catch (error) {
      set({ error: (error as Error).message || 'Could not load notifications.' });
    } finally {
      set({ loading: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function markNoticesRead(ids?: string[]) {
  // Shown as read at once; the server's answer replaces it.
  set({ notices: state.notices.map((notice) => (!ids || ids.includes(notice.id) ? { ...notice, read: true } : notice)) });
  set({ unread: state.notices.filter((notice) => !notice.read).length });
  try {
    const list = await api.markNoticesRead(ids);
    set({ notices: list.notices, unread: list.unread });
  } catch {
    // Stays read on this phone; marked on the server next time.
  }
}

/** Removes them at once; on failure they come back and the error is thrown. Without ids, all. */
export async function deleteNotices(ids?: string[]) {
  const before = state;
  const notices = ids ? state.notices.filter((notice) => !ids.includes(notice.id)) : [];
  set({ notices, unread: notices.filter((notice) => !notice.read).length });
  try {
    const list = await api.deleteNotices(ids);
    set({ notices: list.notices, unread: list.unread });
  } catch (error) {
    set({ notices: before.notices, unread: before.unread });
    throw error;
  }
}

export function replaceNotices(list: { notices: Notice[]; unread: number }) {
  set({ notices: list.notices, unread: list.unread, loaded: true, error: '' });
}

export function clearNotices() {
  set({ notices: [], unread: 0, loaded: false, error: '' });
}

/** Opens what a notification is about: the wallet, or that e-way bill. */
export function openNotice(target: PushData | Notice) {
  const id = 'at' in target ? target.id : target.noticeId;
  if (id) void markNoticesRead([id]);
  if (target.route === 'ewb' && target.targetId) router.push({ pathname: '/ewb/[id]', params: { id: target.targetId } });
  else if (target.route === 'support') router.push('/support');
  else router.push('/wallet');
}
