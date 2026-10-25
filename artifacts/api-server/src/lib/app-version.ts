import { readDoc, withDoc } from "./store";

/**
 * Which Android app versions may still be used. An app older than `minVersionCode`
 * shows a full-screen "Update required" and opens the Play Store; one older than
 * `latestVersionCode` offers the update once. Set from the admin panel after a
 * release is live on the Play Store (ANDROID_MIN_VERSION_CODE until it is set there).
 */
export type AppVersionSetting = { minVersionCode: number; latestVersionCode: number; message: string; updatedAt?: string; updatedBy?: string };

export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.ewayeasy.app";

const envMin = Number(process.env["ANDROID_MIN_VERSION_CODE"] ?? 0);
const fallback: AppVersionSetting = { minVersionCode: Number.isInteger(envMin) && envMin > 0 ? envMin : 0, latestVersionCode: 0, message: "" };

// Read on every app start: kept for a minute so a busy hour costs a few reads, not thousands.
let cached: { value: AppVersionSetting; at: number } | null = null;
const CACHE_MS = 60_000;

export async function appVersionSetting(): Promise<AppVersionSetting> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const saved = await readDoc<AppVersionSetting>("settings", "app-version").catch(() => null);
  const value = saved ? { ...fallback, ...saved } : fallback;
  cached = { value, at: Date.now() };
  return value;
}

export async function setAppVersionSetting(next: Omit<AppVersionSetting, "updatedAt">): Promise<AppVersionSetting> {
  const value: AppVersionSetting = { ...next, updatedAt: new Date().toISOString() };
  await withDoc<AppVersionSetting, null>("settings", "app-version", () => ({ next: value, result: null }));
  cached = { value, at: Date.now() };
  return value;
}
