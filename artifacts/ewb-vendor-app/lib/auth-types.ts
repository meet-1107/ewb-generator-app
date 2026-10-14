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
  /** Email confirmed by Google, or by the email OTP at registration (set by the server). */
  verified: boolean;
  /** `forceRefresh` asks Firebase's server, so it fails for a revoked session. */
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type AuthClient = {
  onChange: (listener: (user: AuthUser | null) => void) => () => void;
  /** Resolves false when the user closes the Google account picker. */
  signInWithGoogle: () => Promise<boolean>;
  /** Throws code `auth/pending-registration` for an account whose email OTP was never completed. */
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /**
   * After the email OTP: creates the Firebase account (or signs in to an
   * unfinished one), lets the server activate it with the single-use grant,
   * then signs out so the user logs in normally.
   */
  createVerifiedAccount: (email: string, password: string, grant: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

/** Firebase codes for a saved session the server no longer accepts, e.g. after a password change. */
const REVOKED_SESSION_CODES = new Set(['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled', 'auth/user-not-found', 'auth/invalid-credential']);

export function isRevokedSession(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return REVOKED_SESSION_CODES.has(code);
}

type FirebaseLikeUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
};

export function toAuthUser(user: FirebaseLikeUser, getIdToken: (forceRefresh?: boolean) => Promise<string>): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    verified: user.emailVerified,
    getIdToken,
  };
}

/** Firebase calls shared by both platforms' createVerifiedAccount. */
export async function completeRegistration(steps: {
  create: () => Promise<{ getIdToken: () => Promise<string> }>;
  signIn: () => Promise<{ getIdToken: () => Promise<string> }>;
  finalize: (idToken: string) => Promise<unknown>;
  signOut: () => Promise<void>;
}) {
  let user;
  try {
    user = await steps.create();
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code !== 'auth/email-already-in-use') throw error;
    // An earlier, unfinished registration: continue it with the same password.
    try {
      user = await steps.signIn();
    } catch {
      throw Object.assign(new Error('An account already uses this email. Sign in, or use “Forgot password?”.'), { code: 'auth/email-already-in-use' });
    }
  }
  try {
    await steps.finalize(await user.getIdToken());
  } finally {
    await steps.signOut().catch(() => undefined);
  }
}

export class PendingRegistrationError extends Error {
  readonly code = 'auth/pending-registration';
  constructor() {
    super('Finish creating your account: verify your email with the 6-digit code.');
  }
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
  'auth/password-does-not-meet-requirements': 'Choose a stronger password: at least 8 characters with letters and numbers.',
  'auth/pending-registration': 'Finish creating your account: verify your email with the 6-digit code.',
  'auth/user-disabled': 'This account has been disabled. Contact support.',
};

export function authErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (MESSAGES[code]) return MESSAGES[code];
  return error instanceof Error && error.message ? error.message : 'We could not complete that request. Check your connection and try again.';
}
