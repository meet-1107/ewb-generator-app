import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  initializeAuth,
  type Persistence,
  type Auth,
} from 'firebase/auth';
import * as AuthModule from 'firebase/auth';

type ReactNativeStorage = {
  setItem: (key: string, value: string) => Promise<void>;
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
};
const getReactNativePersistence = (
  AuthModule as unknown as {
    getReactNativePersistence: (storage: ReactNativeStorage) => Persistence;
  }
).getReactNativePersistence;

const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;

export const firebaseConfigured = Boolean(apiKey && projectId && appId);
let firebaseAuth: Auth | null = null;

if (firebaseConfigured) {
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey,
        projectId,
        appId,
        authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
        storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      });

  try {
    if (Platform.OS === 'web') {
      firebaseAuth = initializeAuth(app, { persistence: browserLocalPersistence });
    } else {
      if (!getReactNativePersistence) {
        throw new Error('Firebase React Native persistence is unavailable in this build.');
      }
      firebaseAuth = initializeAuth(app, {
        persistence: getReactNativePersistence({
          getItem: SecureStore.getItemAsync,
          setItem: SecureStore.setItemAsync,
          removeItem: SecureStore.deleteItemAsync,
        }),
      });
    }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === 'auth/already-initialized') firebaseAuth = getAuth(app);
    else throw error;
  }
}

export const auth = firebaseAuth;
