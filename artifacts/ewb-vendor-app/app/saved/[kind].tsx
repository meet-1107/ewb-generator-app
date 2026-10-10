import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import SavedDetails from '@/components/SavedDetails';

export default function SavedDetailsScreen() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  return <SavedDetails kind={kind === 'products' || kind === 'transporters' ? kind : 'parties'} />;
}
