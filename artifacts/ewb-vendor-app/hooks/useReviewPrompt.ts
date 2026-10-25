import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestStoreReview } from '@/lib/play-store';

const KEY = 'ewb-vendor-v1:review-prompt';
/** E-way bills made before the first ask, and how many more before asking again. */
const FIRST_ASK = 5;
const ASK_AGAIN_AFTER = 10;

type ReviewState = { askAt: number };

/**
 * Shows Google's in-app review card (5 stars, sent straight to the Play Store) once the
 * account has made `FIRST_ASK` e-way bills, and again every `ASK_AGAIN_AFTER` more. No
 * question comes before it: Play policy asks apps to show the card as it is.
 */
export function useReviewPrompt(ewbCount: number) {
  const asking = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || ewbCount < FIRST_ASK || asking.current) return;
    asking.current = true;
    void (async () => {
      try {
        const saved = JSON.parse((await AsyncStorage.getItem(KEY).catch(() => null)) ?? 'null') as ReviewState | null;
        if (ewbCount < (saved?.askAt ?? FIRST_ASK)) return;
        await AsyncStorage.setItem(KEY, JSON.stringify({ askAt: ewbCount + ASK_AGAIN_AFTER })).catch(() => undefined);
        await requestStoreReview().catch(() => undefined);
      } finally {
        asking.current = false;
      }
    })();
  }, [ewbCount]);
}
