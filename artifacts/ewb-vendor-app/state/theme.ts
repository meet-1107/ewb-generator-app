import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'ewb-vendor-v1:theme';
const listeners = new Set<(value: ThemePreference) => void>();
let current: ThemePreference = 'system';

function apply(value: ThemePreference) {
  try {
    // 'unspecified' hands control back to the OS appearance.
    Appearance.setColorScheme?.(value === 'system' ? 'unspecified' : value);
  } catch {
    // Older runtimes (and some web builds) cannot override appearance.
  }
}

export async function loadThemePreference() {
  try {
    const stored = (await AsyncStorage.getItem(KEY)) as ThemePreference | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') current = stored;
  } catch {
    current = 'system';
  }
  apply(current);
  return current;
}

export async function setThemePreference(value: ThemePreference) {
  current = value;
  apply(value);
  listeners.forEach((listener) => listener(value));
  await AsyncStorage.setItem(KEY, value).catch(() => undefined);
}

export function useThemePreference() {
  const [value, setValue] = useState(current);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
