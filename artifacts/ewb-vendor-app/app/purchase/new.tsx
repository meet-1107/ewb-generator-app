import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { purchaseDraft } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';
import { useColors } from '@/hooks/useColors';

/** A new purchase entry, opened in the invoice editor with the party as the seller. */
export default function NewPurchaseRoute() {
  const { business, activeGstin, invoices, saveInvoice, removeInvoice, isHydrated } = useAppStore();
  const colors = useColors();
  const created = useRef(false);

  useEffect(() => {
    if (!isHydrated) return;
    if (!business) {
      router.replace('/setup');
      return;
    }
    if (created.current) return;
    created.current = true;
    // An entry left unsaved earlier (app closed mid-way) is discarded.
    for (const stale of invoices.filter((item) => item.unsaved)) void removeInvoice(stale.id);
    const purchase = purchaseDraft(business, activeGstin);
    void saveInvoice(purchase).then(() => router.replace(`/invoice/${purchase.id}`));
  }, [activeGstin, business, invoices, isHydrated, saveInvoice, removeInvoice]);

  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
}
