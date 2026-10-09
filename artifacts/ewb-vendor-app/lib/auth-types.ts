/**
 * Platform-neutral view of Firebase Authentication. `auth-client.ts` (web,
 * Firebase JS SDK) and `auth-client.native.ts` (Android/iOS, React Native
 * Firebase) both implement `AuthClient`; Metro picks the file per platform.
 */

export type AuthUser = {
  uid: string;
  email: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  /** Mobile number confirmed by OTP, or email address confirmed by link. */
  verified: boolean;
  getIdToken: () => Promise<string>;
};

export type OtpConfirmation = {
  confirm: (code: string) => Promise<void>;
};

export type AuthClient = {
  /** Phone OTP needs the native SDK (reCAPTCHA-free), so it is off on web. */
  phoneSupported: boolean;
  onChange: (listener: (user: AuthUser | null) => void) => () => void;
  /** `phoneNumber` is E.164, e.g. +919876543210. */
  sendOtp: (phoneNumber: string, resend: boolean) => Promise<OtpConfirmation>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createEmailAccount: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

type FirebaseLikeUser = {
  uid: string;
  email: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  emailVerified: boolean;
};

export function toAuthUser(user: FirebaseLikeUser, getIdToken: () => Promise<string>): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    phoneNumber: user.phoneNumber,
    displayName: user.displayName,
    verified: Boolean(user.phoneNumber) || user.emailVerified,
    getIdToken,
  };
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-phone-number': 'That mobile number is not valid. Check it and try again.',
  'auth/missing-phone-number': 'Enter your mobile number.',
  'auth/invalid-verification-code': 'That code is incorrect. Check the SMS and try again.',
  'auth/missing-verification-code': 'Enter the 6-digit code from the SMS.',
  'auth/code-expired': 'That code has expired. Tap "Resend code" to get a new one.',
  'auth/session-expired': 'That code has expired. Tap "Resend code" to get a new one.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/quota-exceeded': 'SMS limit reached for now. Try again later or use email.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase yet.',
  'auth/app-not-authorized': 'This app build is not registered in Firebase (add its SHA fingerprints).',
  'auth/missing-client-identifier': 'This app build is not registered in Firebase (add its SHA fingerprints).',
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

/** Accepts 10-digit Indian mobiles (with or without 0 / 91 prefix) or +E.164. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

export function formatPhone(e164: string) {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match ? `+91 ${match[1]} ${match[2]}` : e164;
}
