import { getAuth } from "firebase-admin/auth";
import { projectId } from "./auth";
import { firebaseApp } from "./firebase";

/**
 * The registered accounts (Firebase Authentication), as the admin panel sees
 * them. Replaceable in tests with `setDirectory`.
 */
export type DirectoryUser = {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  providers: string[];
  adminRole: string | null;
};

export interface Directory {
  list(): Promise<DirectoryUser[]>;
  get(uid: string): Promise<DirectoryUser | null>;
  getByEmail(email: string): Promise<DirectoryUser | null>;
  /** Disables sign-in and revokes existing refresh tokens (or re-enables). */
  setDisabled(uid: string, disabled: boolean): Promise<void>;
  setAdminRole(uid: string, role: string | null): Promise<void>;
}

type FirebaseUser = Awaited<ReturnType<ReturnType<typeof getAuth>["getUser"]>>;

function toUser(user: FirebaseUser): DirectoryUser {
  const role = user.customClaims?.["admin_role"];
  return {
    uid: user.uid,
    email: user.email ?? null,
    name: user.displayName ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null,
    lastSignInAt: user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null,
    providers: user.providerData.map((provider) => provider.providerId),
    adminRole: typeof role === "string" ? role : null,
  };
}

const firebaseDirectory: Directory = {
  async list() {
    const auth = getAuth(firebaseApp());
    const users: DirectoryUser[] = [];
    let pageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, pageToken);
      users.push(...page.users.map(toUser));
      pageToken = page.pageToken;
    } while (pageToken);
    return users;
  },
  async get(uid) {
    try {
      return toUser(await getAuth(firebaseApp()).getUser(uid));
    } catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found") return null;
      throw error;
    }
  },
  async getByEmail(email) {
    try {
      return toUser(await getAuth(firebaseApp()).getUserByEmail(email));
    } catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found") return null;
      throw error;
    }
  },
  async setDisabled(uid, disabled) {
    const auth = getAuth(firebaseApp());
    await auth.updateUser(uid, { disabled });
    if (disabled) await auth.revokeRefreshTokens(uid);
  },
  async setAdminRole(uid, role) {
    const auth = getAuth(firebaseApp());
    const claims = { ...((await auth.getUser(uid)).customClaims ?? {}) };
    if (role) claims["admin_role"] = role;
    else delete claims["admin_role"];
    await auth.setCustomUserClaims(uid, claims);
    // Ends sessions so a removed role cannot keep working from a cached token.
    await auth.revokeRefreshTokens(uid);
  },
};

const emptyDirectory: Directory = {
  async list() { return []; },
  async get() { return null; },
  async getByEmail() { return null; },
  async setDisabled() { throw new Error("No account directory on a sandbox server."); },
  async setAdminRole() { throw new Error("No account directory on a sandbox server."); },
};

let current: Directory = projectId ? firebaseDirectory : emptyDirectory;

export function directory() {
  return current;
}

/** Tests only: replace the account directory. */
export function setDirectory(next: Directory) {
  current = next;
}
