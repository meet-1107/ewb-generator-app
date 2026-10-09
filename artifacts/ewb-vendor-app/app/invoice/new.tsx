import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { draftForBusiness } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';
import { useColors } from '@/hooks/useColors';

export default function NewInvoiceRoute() {
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  const { business, activeGstin, invoices, saveInvoice, isHydrated } = useAppStore();
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
    const invoice = draftForBusiness(business, activeGstin, invoices, templateId);
    void saveInvoice(invoice).then(() => router.replace(`/invoice/${invoice.id}`));
  }, [activeGstin, business, invoices, isHydrated, saveInvoice, templateId]);

  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
}
