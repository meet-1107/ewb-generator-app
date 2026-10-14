import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  getIdToken,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import { api } from '@/lib/api';
import { completeRegistration, PendingRegistrationError, toAuthUser, type AuthClient } from '@/lib/auth-types';

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
    onChange(listener) {
      return onAuthStateChanged(auth, (user) => {
        listener(user ? toAuthUser(user, (forceRefresh) => getIdToken(user, forceRefresh)) : null);
      });
    },
    async signInWithGoogle() {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
        return true;
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return false;
        throw error;
      }
    },
    async signInWithEmail(email, password) {
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (!result.user.emailVerified) {
        await signOut(auth);
        throw new PendingRegistrationError();
      }
    },
    async createVerifiedAccount(email, password, grant) {
      await completeRegistration({
        create: async () => {
          const { user } = await createUserWithEmailAndPassword(auth, email, password);
          return { getIdToken: () => getIdToken(user) };
        },
        signIn: async () => {
          const { user } = await signInWithEmailAndPassword(auth, email, password);
          return { getIdToken: () => getIdToken(user) };
        },
        finalize: (idToken) => api.finalizeRegistration(grant, idToken),
        signOut: () => signOut(auth),
      });
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
