import { useCallback, useState } from 'react';
import { useDialog } from '@/components/Dialog';
import { api, ApiError, type VerifiedGstin } from '@/lib/api';
import { gstinProblem } from '@/lib/domain';

/**
 * Verifies a GSTIN on the server (one gstinapi.in lookup per GSTIN, then
 * served from the server's saved copy) and returns the registered details.
 */
export function useGstinVerify() {
  const dialog = useDialog();
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
      const { gstin: details } = await api.verifyGstin(gstin);
      if (details.status.toLowerCase() !== 'active') {
        await dialog.alert({ title: `GSTIN is ${details.status}`, message: `${details.legalName} is not active on the GST network${details.cancellationDate ? ` (cancelled ${details.cancellationDate})` : ''}. E-way bills may be rejected.`, tone: 'warning' });
      } else {
        dialog.toast('GSTIN verified — details filled in', 'success');
      }
      return details;
    } catch (error) {
      dialog.toast(error instanceof ApiError ? error.message : 'Could not verify right now. You can fill the details by hand.', 'danger');
      return null;
    } finally {
      setVerifying(false);
    }
  }, [dialog]);

  return { verify, verifying };
}
