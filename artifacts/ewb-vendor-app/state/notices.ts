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
/** Bumped by every change made on this phone; a list fetched before it is stale. */
let version = 0;

export function refreshNotices() {
  inFlight ??= (async () => {
    set({ loading: true });
    const started = version;
    try {
      const list = await api.notifications();
      // A delete or mark-read made while this was loading wins over the older list.
      if (started === version) set({ notices: list.notices, unread: list.unread, loaded: true, error: '' });
      else set({ loaded: true, error: '' });
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
  version += 1;
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
  version += 1;
  const mine = version;
  const removed = ids ? state.notices.filter((notice) => ids.includes(notice.id)) : state.notices;
  const notices = ids ? state.notices.filter((notice) => !ids.includes(notice.id)) : [];
  set({ notices, unread: notices.filter((notice) => !notice.read).length });
  try {
    const list = await api.deleteNotices(ids);
    // Only the latest change takes the server's list (an older answer would undo a newer delete).
    if (mine === version) set({ notices: list.notices, unread: list.unread });
  } catch (error) {
    // Only these come back; other deletes made meanwhile stay.
    const back = [...state.notices, ...removed.filter((item) => !state.notices.some((notice) => notice.id === item.id))].sort((a, b) => b.at.localeCompare(a.at));
    set({ notices: back, unread: back.filter((notice) => !notice.read).length });
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
