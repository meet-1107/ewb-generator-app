import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDialog } from '@/components/Dialog';
import { openPlayStore } from '@/lib/play-store';

const KEY = 'ewb-vendor-v1:review-prompt';
/** E-way bills made before the first ask, and how many more after "Later". */
const FIRST_ASK = 5;
const ASK_AGAIN_AFTER = 10;

type ReviewState = { done: boolean; askAt: number };

/**
 * Asks for a Play Store rating once the account has made `FIRST_ASK` e-way bills;
 * "Later" asks again after `ASK_AGAIN_AFTER` more, "Rate now" never asks again.
 */
export function useReviewPrompt(ewbCount: number) {
  const dialog = useDialog();
  const asking = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || ewbCount < FIRST_ASK || asking.current) return;
    asking.current = true;
    void (async () => {
      try {
        const saved = JSON.parse((await AsyncStorage.getItem(KEY).catch(() => null)) ?? 'null') as ReviewState | null;
        const state: ReviewState = saved ?? { done: false, askAt: FIRST_ASK };
        if (state.done || ewbCount < state.askAt) return;
        const rate = await dialog.confirm({
          title: 'Enjoying E-Way Easy?',
          message: `You have made ${ewbCount} e-way bills with E-Way Easy. A quick rating on the Play Store helps other businesses find us.`,
          confirmLabel: 'Rate now',
          cancelLabel: 'Later',
          tone: 'success',
          icon: 'star',
        });
        await AsyncStorage.setItem(KEY, JSON.stringify(rate ? { done: true, askAt: state.askAt } : { done: false, askAt: ewbCount + ASK_AGAIN_AFTER })).catch(() => undefined);
        if (rate) await openPlayStore().catch(() => undefined);
      } finally {
        asking.current = false;
      }
    })();
  }, [ewbCount, dialog]);
}
