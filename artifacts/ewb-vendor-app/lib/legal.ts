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
