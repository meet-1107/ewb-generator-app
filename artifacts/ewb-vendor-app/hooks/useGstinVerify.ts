import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { useDialog } from '@/components/Dialog';
import { api, ApiError, type VerifiedGstin } from '@/lib/api';
import { gstinProblem } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

/**
 * Verifies a GSTIN on the server (one gstinapi.in lookup per GSTIN, then
 * served from the server's saved copy) and returns the registered details.
 * A GSTIN never looked up before is free for the account's first ones; after
 * that it costs a credit, asked here first, and an empty wallet offers Add credits.
 */
export function useGstinVerify() {
  const dialog = useDialog();
  const store = useAppStore();
  const [verifying, setVerifying] = useState(false);

  const verify = useCallback(async (raw: string): Promise<VerifiedGstin | null> => {
    const gstin = raw.trim().toUpperCase();
    const problem = gstinProblem(gstin);
    if (problem) {
      dialog.toast(problem, 'danger');
      return null;
    }
    setVerifying(true);
    try {
      let result: Awaited<ReturnType<typeof api.verifyGstin>>;
      try {
        result = await api.verifyGstin(gstin);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'credit_needed') throw error;
        const cost = Number(error.body.cost) || 1;
        const pay = await dialog.confirm({
          title: 'Free GSTIN verifications used',
          message: `${error.message} Verify ${gstin} now?`,
          confirmLabel: `Verify for ${cost} credit${cost === 1 ? '' : 's'}`,
          cancelLabel: 'Fill by hand',
          tone: 'warning',
          icon: 'credit-card',
        });
        if (!pay) return null;
        result = await api.verifyGstin(gstin, true);
      }
      const { gstin: details, stale, charged, freeLeft } = result;
      if (charged) void store.refreshWallet();
      const paidNote = charged ? ` · ${charged} credit${charged === 1 ? '' : 's'} used` : freeLeft !== undefined && freeLeft <= 5 ? ` · ${freeLeft} free verification${freeLeft === 1 ? '' : 's'} left` : '';
      if (details.status.toLowerCase() !== 'active') {
        await dialog.alert({ title: `GSTIN is ${details.status}`, message: `${details.legalName} is not active on the GST network${details.cancellationDate ? ` (cancelled ${details.cancellationDate})` : ''}. E-way bills may be rejected.`, tone: 'warning' });
      } else if (stale) {
        // The GST network did not answer: the saved details are filled in, with their age.
        const asOf = new Date(details.statusCheckedAt ?? details.verifiedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        dialog.toast(`Details filled in. Status last confirmed ${asOf}.`, 'default');
      } else {
        dialog.toast(`GSTIN verified — details filled in${paidNote}`, 'success');
      }
      return details;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'insufficient_credits') {
        const add = await dialog.confirm({ title: 'Not enough credits', message: error.message, confirmLabel: 'Add credits', cancelLabel: 'Not now', tone: 'warning', icon: 'credit-card' });
        if (add) router.push('/wallet');
        return null;
      }
      dialog.toast(error instanceof ApiError ? error.message : 'Could not verify right now. You can fill the details by hand.', 'danger');
      return null;
    } finally {
      setVerifying(false);
    }
  }, [dialog, store]);

  return { verify, verifying };
}
