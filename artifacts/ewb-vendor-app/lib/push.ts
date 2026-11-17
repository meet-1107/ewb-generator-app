import type { PushClient } from '@/lib/push-types';

/** Web: no push notifications (the bell still lists them). */
export const pushClient: PushClient | null = null;
