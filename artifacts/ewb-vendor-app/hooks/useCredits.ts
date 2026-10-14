import { useCallback } from 'react';
import { router } from 'expo-router';
import { useDialog } from '@/components/Dialog';
import { ApiError, type CreditCosts, type WalletAction } from '@/lib/api';
import { useAppStore } from '@/state/app-store';

const DEFAULT_COSTS: CreditCosts = { generate: 5, part_b: 5, consolidate: 5, cancel: 5, extend: 0 };

/**
 * Credit prompts shared by every paid e-way bill action. The server is the
 * authority (it holds credits and refunds failures); these dialogs make sure
 * the user knows the cost before anything is spent.
 */
export function useCredits() {
  const store = useAppStore();
  const dialog = useDialog();
  const costs = store.wallet?.costs ?? store.config?.creditCosts ?? DEFAULT_COSTS;
  const balance = store.wallet?.balance ?? null;

  /** Resolves true when the user agrees to spend the action's credits. */
  const confirmSpend = useCallback(async (action: WalletAction, what: string) => {
    const cost = costs[action];
    if (!cost) return true;
    if (balance !== null && balance < cost) {
      const open = await dialog.confirm({ title: 'Not enough credits', message: `${what} uses ${cost} credits. Your wallet has ${balance}.`, confirmLabel: 'Open wallet', cancelLabel: 'Not now', tone: 'warning', icon: 'credit-card' });
      if (open) router.push('/wallet');
      return false;
    }
    return dialog.confirm({
      title: `Use ${cost} credits?`,
      message: `${what} uses ${cost} credits.${balance !== null ? ` Balance: ${balance} → ${balance - cost}.` : ''} Credits are refunded automatically if it fails.`,
      confirmLabel: `Use ${cost} credits`,
      icon: 'credit-card',
    });
  }, [balance, costs, dialog]);

  /** Handles wallet / portal-login errors from the server. Returns true when it did. */
  const handleError = useCallback(async (error: unknown) => {
    if (!(error instanceof ApiError)) return false;
    if (error.code === 'insufficient_credits') {
      void store.refreshWallet();
      const open = await dialog.confirm({ title: 'Not enough credits', message: error.message, confirmLabel: 'Open wallet', cancelLabel: 'Not now', tone: 'warning', icon: 'credit-card' });
      if (open) router.push('/wallet');
      return true;
    }
    if (error.code === 'credentials_missing') {
      const open = await dialog.confirm({ title: 'E-way bill portal login needed', message: error.message, confirmLabel: 'Add login', cancelLabel: 'Not now', tone: 'warning', icon: 'key' });
      if (open) router.push({ pathname: '/ewb-login', params: { gstin: String(error.body.gstin ?? '') } });
      return true;
    }
    return false;
  }, [dialog, store]);

  return { costs, balance, confirmSpend, handleError };
}
