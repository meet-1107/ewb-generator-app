import type { NextFunction, Request, Response } from "express";
import { projectId, verifyIdToken } from "./auth";
import { directory } from "./admin-directory";
import { logger } from "./logger";
import { appendLog } from "./store";

/**
 * Admin panel access. Sign-in is the normal Firebase account (verified email);
 * the role is never taken from the request or the app:
 * - a verified email listed in SUPER_ADMIN_EMAILS (server config) is a super admin
 *   — this is how the first admin is created;
 * - anyone else needs the `admin_role` custom claim, which only a super admin
 *   can set (through this API), read live from Firebase Auth (cached 60 s),
 *   so removing a role takes effect within a minute.
 */

export const ADMIN_ROLES = ["super", "finance", "support", "tech"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const PERMISSIONS = {
  /** Dashboard totals. */
  overview: ["super", "finance", "support", "tech"],
  /** User list and detail. */
  users: ["super", "finance", "support", "tech"],
  /** Names, emails and full GSTINs (masked otherwise). */
  pii: ["super", "finance", "support"],
  ewbs: ["super", "finance", "support", "tech"],
  api: ["super", "tech"],
  payments: ["super", "finance", "support"],
  credits: ["super", "finance", "support"],
  "credits.adjust": ["super", "finance"],
  "payments.recheck": ["super", "finance"],
  "users.suspend": ["super"],
  reconcile: ["super", "finance", "tech"],
  audit: ["super", "finance"],
  export: ["super", "finance"],
  health: ["super", "finance", "tech"],
  admins: ["super"],
} as const satisfies Record<string, readonly AdminRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export const ROLE_LABELS: Record<AdminRole, string> = { super: "Super admin", finance: "Finance admin", support: "Support admin", tech: "Technical admin" };

export type AdminIdentity = { uid: string; email: string; role: AdminRole; authTime: number; bootstrap: boolean; permissions: Permission[] };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminIdentity;
    }
  }
}

export const bootstrapEmails = new Set((process.env["SUPER_ADMIN_EMAILS"] ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));

const roleCache = new Map<string, { role: string | null; at: number }>();
const ROLE_TTL_MS = 60_000;

async function liveRole(uid: string) {
  const hit = roleCache.get(uid);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.role;
  const role = (await directory().get(uid))?.adminRole ?? null;
  roleCache.set(uid, { role, at: Date.now() });
  return role;
}

export function forgetRole(uid: string) {
  roleCache.delete(uid);
}

export function permissionsOf(role: AdminRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((permission) => (PERMISSIONS[permission] as readonly string[]).includes(role));
}

export function can(admin: AdminIdentity, permission: Permission) {
  return admin.permissions.includes(permission);
}

/** Appends to the admin audit log (append-only; never fails the request). */
export async function adminAudit(req: Request, event: { action: string; target?: string; outcome: string; reason?: string; before?: unknown; after?: unknown }) {
  try {
    await appendLog("admin_audit", {
      at: new Date().toISOString(),
      adminUid: req.admin?.uid ?? null,
      adminEmail: req.admin?.email ?? null,
      role: req.admin?.role ?? null,
      correlationId: String(req.id ?? ""),
      ip: req.ip ?? null,
      ...event,
      target: event.target ?? null,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, action: event.action }, "Could not write admin audit event");
  }
}

/** Authenticates the caller as an admin. Regular app users get 403. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!projectId) return res.status(503).json({ error: "admin_unavailable", message: "The admin panel needs Firebase sign-in on the server." });
  const token = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1];
  if (!token) return res.status(401).json({ error: "auth_required", message: "Sign in to continue." });
  let claims;
  try {
    claims = await verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: "auth_invalid", message: "Your session expired. Sign in again." });
  }
  if (!claims.emailVerified || !claims.email) return res.status(403).json({ error: "email_unverified", message: "Verify your email first." });
  const bootstrap = bootstrapEmails.has(claims.email);
  let role: string | null;
  try {
    role = bootstrap ? "super" : await liveRole(claims.uid);
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Admin role lookup failed");
    return res.status(503).json({ error: "admin_unavailable", message: "Could not check admin access. Try again." });
  }
  if (!role || !(ADMIN_ROLES as readonly string[]).includes(role)) {
    req.admin = undefined;
    await appendLog("admin_audit", { at: new Date().toISOString(), adminUid: claims.uid, adminEmail: claims.email, role: null, action: "admin.access_denied", target: req.path, outcome: "denied", correlationId: String(req.id ?? ""), ip: req.ip ?? null }).catch(() => undefined);
    return res.status(403).json({ error: "not_admin", message: "This account has no admin access." });
  }
  const adminRole = role as AdminRole;
  req.admin = { uid: claims.uid, email: claims.email, role: adminRole, authTime: claims.authTime, bootstrap, permissions: permissionsOf(adminRole) };
  // Per-admin rate limits key on this.
  req.workspaceId = `admin:${claims.uid}`;
  req.actor = `admin:${claims.uid}`;
  return next();
}

/** Allows the route only for roles that hold `permission`. */
export function allow(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.admin && can(req.admin, permission)) return next();
    await adminAudit(req, { action: "admin.permission_denied", target: `${req.method} ${req.path}`, outcome: `missing:${permission}` });
    return res.status(403).json({ error: "forbidden", message: "Your admin role cannot do this." });
  };
}

/** High-risk actions need a sign-in within the last `minutes` (re-authentication). */
export function recentSignIn(minutes = 15) {
  return (req: Request, res: Response, next: NextFunction) => {
    const age = Date.now() / 1000 - (req.admin?.authTime ?? 0);
    if (age <= minutes * 60) return next();
    return res.status(401).json({ error: "reauth_required", message: `Sign in again to confirm this action (required every ${minutes} minutes for changes).` });
  };
}

export function maskEmail(email: string | null) {
  if (!email) return null;
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export function maskGstin(gstin: string | null | undefined) {
  if (!gstin) return gstin ?? null;
  return gstin.length === 15 ? `${gstin.slice(0, 2)}•••••••${gstin.slice(9)}` : "•••";
}
