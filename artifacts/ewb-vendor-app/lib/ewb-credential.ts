import { api, ApiError } from '@/lib/api';

export type SaveResult = Awaited<ReturnType<typeof api.saveEwbCredential>>;

/**
 * Saves a portal API login. The server checks it with the portal first, which can
 * be slow: if the wait runs out, the saved list is checked before calling it a failure.
 */
export async function saveEwbLogin(gstin: string, username: string, password: string): Promise<SaveResult> {
  // Two minutes early, in case the phone's clock is ahead of the server's.
  const startedAt = new Date(Date.now() - 2 * 60_000).toISOString();
  try {
    return await api.saveEwbCredential(gstin, username, password);
  } catch (error) {
    if (!(error instanceof ApiError) || (error.code !== 'timeout' && error.code !== 'offline')) throw error;
    const list = await api.ewbCredentials().catch(() => null);
    const stored = list?.credentials.find((item) => item.gstin === gstin && item.username === username && item.updatedAt >= startedAt);
    if (!stored) throw error;
    return { credential: stored, checked: false, message: 'Login saved. It will be checked with the portal on your first e-way bill.' };
  }
}

/** The portal's answer in plain words. */
export function credentialError(error: unknown) {
  if (!(error instanceof ApiError)) return 'Could not save. Check your connection and try again.';
  if (error.code === 'credentials_invalid') return `${error.message}\n\nCheck the API username (grey part + your 3 letters) and the password, then try again.`;
  if (error.code === 'timeout') return 'The e-way bill portal is slow right now. Please try again in a minute.';
  return error.message;
}
