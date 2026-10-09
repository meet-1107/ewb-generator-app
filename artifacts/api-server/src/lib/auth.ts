import { createPublicKey, verify } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Identifies the calling workspace.
 *
 * - When FIREBASE_PROJECT_ID is set, a Firebase ID token is required
 *   (`Authorization: Bearer <token>`) and verified against Google's public
 *   certificates. The workspace is the verified uid.
 * - Otherwise the server runs in sandbox mode and accepts an opaque
 *   `x-workspace-id` generated on the device. Sandbox mode must never be used
 *   with real business data.
 */

const projectId = process.env["FIREBASE_PROJECT_ID"];
const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certs: { keys: Record<string, string>; expiresAt: number } | null = null;

export const authMode = projectId ? "firebase" : "sandbox";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspaceId: string;
      actor: string;
    }
  }
}

async function publicKeys() {
  if (certs && certs.expiresAt > Date.now()) return certs.keys;
  const response = await fetch(CERT_URL);
  if (!response.ok) throw new Error("Could not fetch Firebase signing keys.");
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  certs = { keys: (await response.json()) as Record<string, string>, expiresAt: Date.now() + maxAge * 1000 };
  return certs.keys;
}

function decodeSegment(segment: string) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function verifyFirebaseToken(token: string) {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) throw new Error("Malformed token");
  const header = decodeSegment(headerPart);
  const payload = decodeSegment(payloadPart);
  if (header["alg"] !== "RS256" || typeof header["kid"] !== "string") throw new Error("Unexpected token algorithm");
  const cert = (await publicKeys())[header["kid"]];
  if (!cert) throw new Error("Unknown signing key");
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    createPublicKey(cert),
    Buffer.from(signaturePart, "base64url"),
  );
  const now = Math.floor(Date.now() / 1000);
  if (
    !valid ||
    payload["aud"] !== projectId ||
    payload["iss"] !== `https://securetoken.google.com/${projectId}` ||
    typeof payload["sub"] !== "string" ||
    !payload["sub"] ||
    Number(payload["exp"]) <= now ||
    Number(payload["iat"]) > now + 300
  ) {
    throw new Error("Token rejected");
  }
  return payload["sub"];
}

export async function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  try {
    if (projectId) {
      const token = /^Bearer (.+)$/.exec(req.header("authorization") ?? "")?.[1];
      if (!token) return res.status(401).json({ error: "auth_required", message: "Sign in again to continue." });
      const uid = await verifyFirebaseToken(token);
      req.workspaceId = uid.replace(/[^A-Za-z0-9_-]/g, "");
      req.actor = uid;
    } else {
      const id = req.header("x-workspace-id") ?? "";
      if (!/^[A-Za-z0-9_-]{12,64}$/.test(id)) {
        return res.status(401).json({ error: "workspace_required", message: "This device has no workspace ID yet." });
      }
      req.workspaceId = `sbx_${id}`;
      req.actor = req.workspaceId;
    }
    return next();
  } catch {
    return res.status(401).json({ error: "auth_invalid", message: "Your session expired. Sign in again." });
  }
}
