import Constants from 'expo-constants';
import type * as RNFirebaseAuth from '@react-native-firebase/auth';
import type * as GoogleSignInModule from '@react-native-google-signin/google-signin';
import { toAuthUser, type AuthClient } from '@/lib/auth-types';

/**
 * Android / iOS: React Native Firebase, configured from google-services.json
 * at build time, plus native Google Sign-In. Expo Go has neither native
 * module, so there the client is null and the sign-in screen offers local
 * preview instead.
 */

// Firebase's "Web client" OAuth ID; app.config.js reads it from google-services.json.
const webClientId = (Constants.expoConfig?.extra as { googleWebClientId?: string } | undefined)?.googleWebClientId;

function load(): AuthClient | null {
  let sdk: typeof RNFirebaseAuth;
  let google: typeof GoogleSignInModule;
  let auth: RNFirebaseAuth.Auth;
  try {
    sdk = require('@react-native-firebase/auth') as typeof RNFirebaseAuth;
    google = require('@react-native-google-signin/google-signin') as typeof GoogleSignInModule;
    auth = sdk.getAuth();
  } catch {
    return null;
  }
  if (webClientId) google.GoogleSignin.configure({ webClientId });

  return {
    onChange(listener) {
      return sdk.onAuthStateChanged(auth, (user) => {
        listener(user ? toAuthUser(user, () => sdk.getIdToken(user)) : null);
      });
    },
    async signInWithGoogle() {
      if (!webClientId) {
        throw new Error('Google sign-in is not set up yet. Enable Google in Firebase Authentication, then download google-services.json again.');
      }
      try {
        await google.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const response = await google.GoogleSignin.signIn();
        if (!google.isSuccessResponse(response)) return false;
        const { idToken } = response.data;
        if (!idToken) throw new Error('Google did not return a sign-in token. Try again.');
        await sdk.signInWithCredential(auth, sdk.GoogleAuthProvider.credential(idToken));
        return true;
      } catch (error) {
        if (google.isErrorWithCode(error) && (error.code === google.statusCodes.SIGN_IN_CANCELLED || error.code === google.statusCodes.IN_PROGRESS)) {
          return false;
        }
        throw error;
      }
    },
    async signInWithEmail(email, password) {
      const result = await sdk.signInWithEmailAndPassword(auth, email, password);
      if (!result.user.emailVerified) {
        await sdk.signOut(auth);
        throw new Error('Check your inbox and verify your email before signing in.');
      }
    },
    async createEmailAccount(name, email, password) {
      const result = await sdk.createUserWithEmailAndPassword(auth, email, password);
      await sdk.updateProfile(result.user, { displayName: name });
      await sdk.sendEmailVerification(result.user);
      await sdk.signOut(auth);
    },
    async resetPassword(email) {
      await sdk.sendPasswordResetEmail(auth, email);
    },
    async signOut() {
      // Also clear the Google session so the account picker shows next time.
      await google.GoogleSignin.signOut().catch(() => undefined);
      await sdk.signOut(auth);
    },
  };
}

export const authClient = load();
