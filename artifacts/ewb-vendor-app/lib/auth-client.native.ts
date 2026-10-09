import type * as RNFirebaseAuth from '@react-native-firebase/auth';
import { toAuthUser, type AuthClient, type OtpConfirmation } from '@/lib/auth-types';

/**
 * Android / iOS: React Native Firebase, configured from google-services.json
 * at build time. Expo Go has no native Firebase module, so there the client is
 * null and the sign-in screen offers local preview instead.
 */

type ConfirmationLike = { confirm: (code: string) => Promise<unknown> };
type PhoneCapableAuth = {
  // Instance method: unlike the modular wrapper, it forwards `forceResend`.
  signInWithPhoneNumber: (phoneNumber: string, forceResend?: boolean) => Promise<ConfirmationLike>;
};

function load(): AuthClient | null {
  let sdk: typeof RNFirebaseAuth;
  let auth: RNFirebaseAuth.Auth;
  try {
    sdk = require('@react-native-firebase/auth') as typeof RNFirebaseAuth;
    auth = sdk.getAuth();
  } catch {
    return null;
  }

  return {
    phoneSupported: true,
    onChange(listener) {
      return sdk.onAuthStateChanged(auth, (user) => {
        listener(user ? toAuthUser(user, () => sdk.getIdToken(user)) : null);
      });
    },
    async sendOtp(phoneNumber, resend): Promise<OtpConfirmation> {
      const confirmation = await (auth as unknown as PhoneCapableAuth).signInWithPhoneNumber(phoneNumber, resend);
      return {
        async confirm(code) {
          await confirmation.confirm(code);
        },
      };
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
      await sdk.signOut(auth);
    },
  };
}

export const authClient = load();
