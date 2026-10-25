import { readDoc, withDoc } from "./store";

/**
 * The latest Android release on the Play Store, set from the admin panel once it is live:
 * older apps show an "update available" alert once (Update or Later); updating is never
 * forced. `minVersionCode` is kept for settings saved before and is treated the same way.
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
