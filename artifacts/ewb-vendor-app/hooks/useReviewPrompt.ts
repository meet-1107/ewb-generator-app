import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'ewb-vendor-v2:rate-prompt';
/** E-way bills made before the first ask, and how many more before asking again after "Later". */
const FIRST_ASK = 2;
const ASK_AGAIN_AFTER = 10;

type RateState = { askAt: number; rated?: boolean };

/**
 * When to show the "Rate us" sheet: once the account has made FIRST_ASK e-way bills, and
 * after "Later" again every ASK_AGAIN_AFTER more. After "Rate now" it is not shown again.
 */
export function useReviewPrompt(ewbCount: number, active: boolean) {
  const [visible, setVisible] = useState(false);
  const checking = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || !active || ewbCount < FIRST_ASK || checking.current || visible) return;
    checking.current = true;
    void (async () => {
      try {
        const saved = JSON.parse((await AsyncStorage.getItem(KEY).catch(() => null)) ?? 'null') as RateState | null;
        if (saved?.rated || ewbCount < (saved?.askAt ?? FIRST_ASK)) return;
        // A moment after the bill screen opens, not on top of the success message.
        setTimeout(() => setVisible(true), 1500);
      } catch {
        // Unreadable setting: simply not shown.
      } finally {
        checking.current = false;
      }
    })();
  }, [ewbCount, active, visible]);

  const close = (rated: boolean) => {
    setVisible(false);
    void AsyncStorage.setItem(KEY, JSON.stringify({ askAt: ewbCount + ASK_AGAIN_AFTER, rated })).catch(() => undefined);
  };

  return { visible, rated: () => close(true), later: () => close(false) };
}
