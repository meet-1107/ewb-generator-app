import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { newInvoice } from '@/lib/domain';
import { useAppStore } from '@/state/app-store';
import { useColors } from '@/hooks/useColors';

export default function NewInvoiceRoute() {
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  const { business, activeGstin, saveInvoice, isHydrated } = useAppStore();
  const colors = useColors();
  const created = useRef(false);

  useEffect(() => {
    if (!isHydrated || !business || created.current) return;
    created.current = true;
    const invoice = {
      ...newInvoice(templateId || 'classic'),
      sellerName: business.name,
      sellerGstin: activeGstin || business.gstin,
      sellerAddress: business.address,
      sellerState: business.state,
    };
    void saveInvoice(invoice).then(() => router.replace(`/invoice/${invoice.id}`));
  }, [activeGstin, business, isHydrated, saveInvoice, templateId]);

  useEffect(() => {
    if (isHydrated && !business) router.replace('/setup');
  }, [business, isHydrated]);

  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;
}
