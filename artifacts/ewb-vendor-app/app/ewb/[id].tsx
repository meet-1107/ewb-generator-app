import React from 'react';
import { router } from 'expo-router';
import { Button, Heading, Notice, Page } from '@/components/AppUI';

export default function EwbDetailScreen() {
  return (
    <Page>
      <Heading eyebrow="Bill record" title="E-way bill detail" subtitle="Generated documents and provider-reported status appear here." />
      <Notice title="No verified EWB record is available" body="A bill appears here only after an authorized provider confirms generation and returns an EWB number. This app build has no EWB provider connected." tone="warning" />
      <Button title="Back to e-way bills" secondary onPress={() => router.replace('/(tabs)/ewbs')} />
    </Page>
  );
}
