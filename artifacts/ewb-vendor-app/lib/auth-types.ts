/**
 * Platform-neutral view of Firebase Authentication (Google + email/password).
 * `auth-client.ts` (web, Firebase JS SDK) and `auth-client.native.ts`
 * (Android/iOS, React Native Firebase + Google Sign-In) both implement
 * `AuthClient`; Metro picks the file per platform.
 */

export type AuthUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  /** Email confirmed by Google or by the verification link. */
  verified: boolean;
  getIdToken: () => Promise<string>;
};

export type AuthClient = {
  onChange: (listener: (user: AuthUser | null) => void) => () => void;
  /** Resolves false when the user closes the Google account picker. */
  signInWithGoogle: () => Promise<boolean>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createEmailAccount: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

type FirebaseLikeUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
};

export function toAuthUser(user: FirebaseLikeUser, getIdToken: () => Promise<string>): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    verified: user.emailVerified,
    getIdToken,
  };
}

const MESSAGES: Record<string, string> = {
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase yet.',
  'auth/account-exists-with-different-credential': 'This email already has an account. Sign in with email and password.',
  'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
  // Google Sign-In on Android: SHA fingerprint or web client ID does not match Firebase.
  DEVELOPER_ERROR: 'Google sign-in is not set up for this app build yet (SHA fingerprints / google-services.json).',
  '10': 'Google sign-in is not set up for this app build yet (SHA fingerprints / google-services.json).',
  PLAY_SERVICES_NOT_AVAILABLE: 'Google Play services is missing or out of date on this phone. Update it, or use email.',
  'auth/network-request-failed': 'You appear to be offline. Check your connection and try again.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/invalid-email': 'That email address is not valid.',
  'auth/email-already-in-use': 'An account already uses this email. Sign in instead.',
  'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
  'auth/user-disabled': 'This account has been disabled. Contact support.',
};

export function authErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (MESSAGES[code]) return MESSAGES[code];
  return error instanceof Error && error.message ? error.message : 'We could not complete that request. Check your connection and try again.';
}
