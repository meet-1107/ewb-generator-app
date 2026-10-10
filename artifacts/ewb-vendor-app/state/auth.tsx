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
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import type { AuthUser } from '@/lib/auth-types';

const PREVIEW_KEY = 'ewb-vendor-v1:preview-session';
const firebaseConfigured = Boolean(authClient);

type AuthValue = {
  user: AuthUser | null;
  /** Preview session, or a Firebase user with a verified email (Google or link). */
  signedIn: boolean;
  isLoading: boolean;
  previewMode: boolean;
  firebaseConfigured: boolean;
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

  useEffect(() => {
    if (!authClient) return;
    return authClient.onChange((nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
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
      enterPreview,
      exitPreview,
      signInWithGoogle() {
        return requireClient().signInWithGoogle();
      },
      signIn(email, password) {
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
      resetPassword(email) {
        return requireClient().resetPassword(email.trim());
      },
      async signOut() {
        setPreviewMode(false);
        await AsyncStorage.removeItem(PREVIEW_KEY).catch(() => undefined);
        if (authClient) await authClient.signOut();
      },
    }),
    [user, isLoading, previewMode, enterPreview, exitPreview],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
