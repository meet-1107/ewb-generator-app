import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';

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
