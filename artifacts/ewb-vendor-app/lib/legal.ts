import { API_BASE } from '@/lib/api';

/** Same as LEGAL_VERSION on the server: the Terms & Privacy Policy every account must accept. */
export const LEGAL_VERSION = '2026-10-15';

/** Public pages served with the API (Firebase Hosting): hosting/terms.html and hosting/privacy.html. */
export const TERMS_URL = `${API_BASE}/terms`;
export const PRIVACY_URL = `${API_BASE}/privacy`;

/** Device key: this account accepted LEGAL_VERSION (the server keeps the record). */
export const consentKey = (workspaceId: string) => `ewb-vendor-v1:consent:${workspaceId}`;
/** Set when the box was ticked at sign-up, before the account existed; sent once signed in. */
export const PENDING_CONSENT_KEY = 'ewb-vendor-v1:consent-pending';

/** How long a ticked sign-up box counts for the account that signs in next. */
const PENDING_TTL_MS = 30 * 60_000;

/** The sign-up tick: the version, when, and the email when known (Google sign-up picks it later). */
export const pendingConsent = (email = '') => JSON.stringify({ version: LEGAL_VERSION, at: Date.now(), email: email.trim().toLowerCase() });

/** Whether a saved sign-up tick belongs to this account: same version, recent, and the same email if one was given. */
export function pendingConsentFor(saved: string | null, email: string | null | undefined) {
  try {
    const pending = JSON.parse(saved ?? '') as { version?: string; at?: number; email?: string };
    return pending.version === LEGAL_VERSION && Date.now() - (pending.at ?? 0) < PENDING_TTL_MS && (!pending.email || pending.email === (email ?? '').toLowerCase());
  } catch {
    return false;
  }
}
