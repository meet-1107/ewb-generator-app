import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { isRevokedSession, type AuthUser } from '@/lib/auth-types';

const PREVIEW_KEY = 'ewb-vendor-v1:preview-session';
const firebaseConfigured = Boolean(authClient);

type AuthValue = {
  user: AuthUser | null;
  /** Preview session, or a Firebase user with a verified email (Google or link). */
  signedIn: boolean;
  isLoading: boolean;
  previewMode: boolean;
  firebaseConfigured: boolean;
  /** The saved session was revoked (e.g. password changed elsewhere); the user must sign in again. */
  sessionExpired: boolean;
  enterPreview: () => void;
  exitPreview: () => void;
  /** Signs in or creates an account with Google. Resolves false if the user cancels. */
  signInWithGoogle: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Request a 6-digit code for registration. Resolves the resend cooldown in seconds. */
  sendRegistrationCode: (email: string) => Promise<number>;
  /** Verify the code, create + activate the account, then sign out (the user logs in next). */
  completeRegistration: (email: string, password: string, code: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function requireClient() {
  if (!authClient) throw new Error('Firebase Authentication is not configured.');
  return authClient;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(firebaseConfigured);
  const [previewLoading, setPreviewLoading] = useState(!firebaseConfigured);
  const [previewMode, setPreviewMode] = useState(false);
  const isLoading = authLoading || previewLoading;

  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    if (!authClient) return;
    const client = authClient;
    let first = true;
    let latest = 0;
    return client.onChange((nextUser) => {
      const event = ++latest;
      const restored = first && nextUser !== null;
      first = false;
      if (!restored) {
        setUser(nextUser);
        setAuthLoading(false);
        return;
      }
      // A session saved on the device can be revoked meanwhile (password changed, account
      // disabled). Check it with Firebase before opening the app, so it goes straight to
      // sign-in instead of opening the workspace and failing. Offline keeps the saved session.
      const check = nextUser.getIdToken(true).then(() => true, (error: unknown) => !isRevokedSession(error));
      const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 6000));
      void Promise.race([check, timeout]).then(async (valid) => {
        if (event !== latest) return;
        if (valid) {
          setUser(nextUser);
          setAuthLoading(false);
          return;
        }
        setSessionExpired(true);
        await client.signOut().catch(() => undefined);
        if (event !== latest) return;
        setUser(null);
        setAuthLoading(false);
      });
    });
  }, []);

  // Preview sessions survive reloads and deep links (preview is only offered without Firebase).
  useEffect(() => {
    if (firebaseConfigured) return;
    AsyncStorage.getItem(PREVIEW_KEY)
      .then((value) => setPreviewMode(value === '1'))
      .catch(() => undefined)
      .finally(() => setPreviewLoading(false));
  }, []);

  const enterPreview = useCallback(() => {
    setPreviewMode(true);
    void AsyncStorage.setItem(PREVIEW_KEY, '1').catch(() => undefined);
  }, []);
  const exitPreview = useCallback(() => {
    setPreviewMode(false);
    void AsyncStorage.removeItem(PREVIEW_KEY).catch(() => undefined);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      signedIn: previewMode || Boolean(user?.verified),
      isLoading,
      previewMode,
      firebaseConfigured,
      sessionExpired,
      enterPreview,
      exitPreview,
      signInWithGoogle() {
        setSessionExpired(false);
        return requireClient().signInWithGoogle();
      },
      signIn(email, password) {
        setSessionExpired(false);
        return requireClient().signInWithEmail(email.trim(), password);
      },
      async sendRegistrationCode(email) {
        requireClient();
        const { cooldownSeconds } = await api.sendEmailOtp(email.trim());
        return cooldownSeconds;
      },
      async completeRegistration(email, password, code) {
        const client = requireClient();
        const { grant } = await api.verifyEmailOtp(email.trim(), code.trim());
        await client.createVerifiedAccount(email.trim().toLowerCase(), password, grant);
      },
      async resetPassword(email) {
        // Our own email first; Firebase's email if the server cannot send it.
        try {
          await api.requestPasswordReset(email.trim());
        } catch (error) {
          if (error instanceof ApiError && error.status === 400) throw error;
          await requireClient().resetPassword(email.trim());
        }
      },
      async signOut() {
        setPreviewMode(false);
        await AsyncStorage.removeItem(PREVIEW_KEY).catch(() => undefined);
        if (authClient) await authClient.signOut();
      },
    }),
    [user, isLoading, previewMode, sessionExpired, enterPreview, exitPreview],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
