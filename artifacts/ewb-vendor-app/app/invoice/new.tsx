import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { draftForBusiness } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';
import { useColors } from '@/hooks/useColors';

export default function NewInvoiceRoute() {
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  const { business, activeGstin, invoices, ewbs, saveInvoice, removeInvoice, isHydrated } = useAppStore();
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
    // A new invoice left unsaved earlier (app closed mid-way) is discarded.
    for (const stale of invoices.filter((item) => item.unsaved)) void removeInvoice(stale.id);
    const invoice = draftForBusiness(business, activeGstin, invoices, templateId, ewbs);
    void saveInvoice(invoice).then(() => router.replace(`/invoice/${invoice.id}`));
  }, [activeGstin, business, invoices, ewbs, isHydrated, saveInvoice, removeInvoice, templateId]);

  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
}
