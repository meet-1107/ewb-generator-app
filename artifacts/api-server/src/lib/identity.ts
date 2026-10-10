import { getAuth } from "firebase-admin/auth";
import { projectId } from "./auth";
import { firebaseApp } from "./firebase";

/** Firebase Authentication user management (Admin SDK). Never shipped to the app. */

export type IdentityUser = { uid: string; email: string; emailVerified: boolean; disabled: boolean; providers: string[] };

export interface Identity {
  getUserByEmail(email: string): Promise<IdentityUser | null>;
  markEmailVerified(uid: string): Promise<void>;
}

function auth() {
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not set.");
  return getAuth(firebaseApp());
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
