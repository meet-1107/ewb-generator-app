import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { projectId } from "./auth";

/**
 * Firebase Authentication user management (Admin SDK). Credentials come from
 * Application Default Credentials: the Cloud Run service account in
 * production, or GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON
 * file) on a developer machine. Never shipped to the app.
 */

export type IdentityUser = { uid: string; email: string; emailVerified: boolean; disabled: boolean; providers: string[] };

export interface Identity {
  getUserByEmail(email: string): Promise<IdentityUser | null>;
  markEmailVerified(uid: string): Promise<void>;
}

function auth() {
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not set.");
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId });
  return getAuth(app);
}

export const firebaseIdentity: Identity = {
  async getUserByEmail(email) {
    try {
      const user = await auth().getUserByEmail(email);
      return {
        uid: user.uid,
        email: user.email ?? email,
        emailVerified: user.emailVerified,
        disabled: user.disabled,
        providers: user.providerData.map((provider) => provider.providerId),
      };
    } catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found") return null;
      throw error;
    }
  },
  async markEmailVerified(uid) {
    await auth().updateUser(uid, { emailVerified: true });
  },
};
