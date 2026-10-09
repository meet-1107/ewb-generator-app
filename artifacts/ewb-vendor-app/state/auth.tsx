import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, firebaseConfigured } from '@/lib/firebase';

type AuthValue = {
  user: User | null;
  isLoading: boolean;
  previewMode: boolean;
  firebaseConfigured: boolean;
  enterPreview: () => void;
  exitPreview: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  createAccount: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(auth));
  const [previewMode, setPreviewMode] = useState(false);

  useEffect(() => {
    if (!auth) {
      setIsLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setIsLoading(false);
    });
  }, []);

  const enterPreview = useCallback(() => setPreviewMode(true), []);
  const exitPreview = useCallback(() => setPreviewMode(false), []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      isLoading,
      previewMode,
      firebaseConfigured,
      enterPreview,
      exitPreview,
      async signIn(email, password) {
        if (!auth) throw new Error('Firebase Authentication is not configured.');
        const result = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (!result.user.emailVerified) {
          await firebaseSignOut(auth);
          throw new Error('Check your inbox and verify your email before signing in.');
        }
      },
      async createAccount(name, email, password) {
        if (!auth) throw new Error('Firebase Authentication is not configured.');
        const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(result.user, { displayName: name.trim() });
        await sendEmailVerification(result.user);
        await firebaseSignOut(auth);
      },
      async resetPassword(email) {
        if (!auth) throw new Error('Firebase Authentication is not configured.');
        await sendPasswordResetEmail(auth, email.trim());
      },
      async signOut() {
        setPreviewMode(false);
        if (auth) await firebaseSignOut(auth);
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
