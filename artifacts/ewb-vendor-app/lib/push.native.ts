import { PermissionsAndroid, Platform } from 'react-native';
import type * as RNFirebaseMessaging from '@react-native-firebase/messaging';
import { api } from '@/lib/api';
import type { PushClient, PushData } from '@/lib/push-types';

/**
 * Android / iOS push with Firebase Cloud Messaging. The server sends a
 * notification (shown by the system when the app is in the background) with
 * `route` / `targetId` data, which a tap hands to `onOpen`.
 * Expo Go has no native module, so there push is off.
 */
function load(): PushClient | null {
  let sdk: typeof RNFirebaseMessaging;
  let messaging: ReturnType<typeof RNFirebaseMessaging.getMessaging>;
  try {
    sdk = require('@react-native-firebase/messaging') as typeof RNFirebaseMessaging;
    messaging = sdk.getMessaging();
  } catch {
    return null;
  }
  // The system shows notification messages by itself; this only keeps the SDK from warning.
  sdk.setBackgroundMessageHandler(messaging, async () => undefined);

  const data = (message: { data?: Record<string, unknown> } | null | undefined): PushData | null => {
    const raw = message?.data;
    if (!raw || typeof raw.route !== 'string') return null;
    return { route: raw.route === 'ewb' || raw.route === 'support' ? raw.route : 'wallet', targetId: typeof raw.targetId === 'string' && raw.targetId ? raw.targetId : undefined, noticeId: typeof raw.noticeId === 'string' ? raw.noticeId : undefined };
  };

  let saved = '';
  return {
    async register() {
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        const result = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never);
        if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
      } else {
        const status = await sdk.requestPermission(messaging);
        if (status === sdk.AuthorizationStatus.DENIED) return false;
      }
      if (!sdk.isDeviceRegisteredForRemoteMessages(messaging)) await sdk.registerDeviceForRemoteMessages(messaging);
      const token = await sdk.getToken(messaging);
      if (!token) throw new Error('Firebase gave no push token.');
      if (token && token !== saved) {
        await api.savePushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
        saved = token;
      }
      return true;
    },
    onTokenRefresh() {
      return sdk.onTokenRefresh(messaging, (token) => {
        saved = token;
        void api.savePushToken(token, Platform.OS === 'ios' ? 'ios' : 'android').catch(() => undefined);
      });
    },
    async unregister() {
      try {
        const token = saved || (await sdk.getToken(messaging));
        if (token) await api.removePushToken(token).catch(() => undefined);
        await sdk.deleteToken(messaging);
      } catch {
        // Offline: the server drops the token once FCM stops accepting it.
      }
      saved = '';
    },
    onForeground(listener) {
      return sdk.onMessage(messaging, (message) => listener(message.notification?.title ?? '', message.notification?.body ?? '', data(message)));
    },
    onOpen(listener) {
      const stop = sdk.onNotificationOpenedApp(messaging, (message) => {
        const opened = data(message);
        if (opened) listener(opened);
      });
      // The tap that started the app.
      void sdk.getInitialNotification(messaging).then((message) => {
        const opened = data(message);
        if (opened) listener(opened);
      }).catch(() => undefined);
      return stop;
    },
  };
}

export const pushClient: PushClient | null = load();
