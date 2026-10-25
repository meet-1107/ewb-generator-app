import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as StoreReview from 'expo-store-review';

const PACKAGE = 'com.ewayeasy.app';
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PACKAGE}`;

/** This build's Android version code (0 off Android). */
export function appVersionCode() {
  return Platform.OS === 'android' ? Number(Constants.expoConfig?.android?.versionCode ?? 0) : 0;
}

/** Opens the app's Play Store page: in the Play Store app when it is there, else in the browser. */
export async function openPlayStore(webUrl = PLAY_STORE_URL) {
  if (Platform.OS === 'android') {
    try {
      await Linking.openURL(`market://details?id=${PACKAGE}`);
      return;
    } catch {
      // No Play Store app: the web page below.
    }
  }
  await Linking.openURL(webUrl);
}

/**
 * Google's in-app review: the Play Store's own 5-star card over the app, and the stars the
 * user picks go straight to the Play Store. Google decides whether to show it (it shows only
 * for an app installed from the Play Store, and only a few times a year per user); where it
 * cannot be shown at all, the Play Store page opens instead.
 */
export async function requestStoreReview(webUrl = PLAY_STORE_URL) {
  try {
    if (await StoreReview.isAvailableAsync()) {
      await StoreReview.requestReview();
      return;
    }
  } catch {
    // The review card could not start: the Play Store page below.
  }
  await openPlayStore(webUrl);
}
