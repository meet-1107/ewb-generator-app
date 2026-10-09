import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  getIdToken,
  initializeAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
} from 'firebase/auth';
import { toAuthUser, type AuthClient } from '@/lib/auth-types';

/**
 * Web: Firebase JS SDK, configured from EXPO_PUBLIC_FIREBASE_* at build time.
 * Native builds use auth-client.native.ts instead.
 */

const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;

function load(): AuthClient | null {
  if (!apiKey || !projectId || !appId) return null;
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
  let auth: Auth;
  try {
    auth = initializeAuth(app, { persistence: browserLocalPersistence });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code !== 'auth/already-initialized') throw error;
    auth = getAuth(app);
  }

  return {
    phoneSupported: false,
    onChange(listener) {
      return onAuthStateChanged(auth, (user) => {
        listener(user ? toAuthUser(user, () => getIdToken(user)) : null);
      });
    },
    async sendOtp() {
      throw new Error('Mobile number sign-in is available in the Android app. Use email here.');
    },
    async signInWithEmail(email, password) {
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (!result.user.emailVerified) {
        await signOut(auth);
        throw new Error('Check your inbox and verify your email before signing in.');
      }
    },
    async createEmailAccount(name, email, password) {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(result.user, { displayName: name });
      await sendEmailVerification(result.user);
      await signOut(auth);
    },
    async resetPassword(email) {
      await sendPasswordResetEmail(auth, email);
    },
    async signOut() {
      await signOut(auth);
    },
  };
}

export const authClient = load();
