import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for the e-way bill portal passwords users save. The key comes
 * from EWB_CREDENTIALS_SECRET (any long random string); without it, saving
 * credentials is refused so passwords are never stored in plain text.
 */

const secret = process.env["EWB_CREDENTIALS_SECRET"] ?? "";
export const secretsConfigured = secret.length >= 16;
const key = createHash("sha256").update(secret).digest();

export function encryptSecret(plain: string) {
  if (!secretsConfigured) throw new Error("EWB_CREDENTIALS_SECRET is not set on the server.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(sealed: string) {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Stored credential is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
