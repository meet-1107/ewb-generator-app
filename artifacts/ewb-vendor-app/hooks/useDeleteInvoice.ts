import { useCallback } from 'react';
import { useDialog } from '@/components/Dialog';
import { formatInr, invoiceTotals, isPurchase, type Invoice } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';

/**
 * Deletes an invoice after the user confirms. An invoice with an active
 * e-way bill is kept: the bill must be cancelled first. `beforeRemove` runs
 * just before the delete (the editor uses it to stop its autosave).
 */
export function useDeleteInvoice() {
  const store = useAppStore();
  const dialog = useDialog();
  return useCallback(async (invoice: Invoice, beforeRemove?: () => void) => {
    const number = invoice.invoiceNumber || 'without number';
    if (invoice.status === 'ewb_generated') {
      await dialog.alert({
        title: 'Cancel the e-way bill first',
        message: `Invoice ${number} has e-way bill ${invoice.ewbNumber ?? ''} on it. Cancel the e-way bill from the E-way bills tab, then you can delete the invoice.`,
        tone: 'warning',
      });
      return false;
    }
    const ok = await dialog.confirm({
      title: `Delete invoice ${number}?`,
      message: `${(isPurchase(invoice) ? invoice.sellerName : invoice.buyerName) || 'No party'} · ${formatInr(invoiceTotals(invoice).total)}\nIt will be removed from all your devices. This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      tone: 'danger',
      icon: 'trash-2',
    });
    if (!ok) return false;
    beforeRemove?.();
    await store.removeInvoice(invoice.id);
    dialog.toast(`Invoice ${number} deleted`);
    return true;
  }, [store, dialog]);
}
