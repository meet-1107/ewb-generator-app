import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Divider, KeyValue, ScreenHeader, StatusPill, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { API_BASE, SUPPORT_EMAIL } from '@/lib/api';
import { useAppStore } from '@/state/app-store';

const FAQ = [
  { q: 'When do I need an e-way bill?', a: 'Generally when moving goods worth more than ₹50,000 in one consignment. Some states and goods have different thresholds — check with your tax advisor.' },
  { q: 'How long is an e-way bill valid?', a: 'One day for every 200 km (or part of it) for regular cargo, and one day per 20 km for over-dimensional cargo. Validity ends at midnight of the last day.' },
  { q: 'Can I change a bill after generating it?', a: 'You can update the vehicle (Part-B) while the bill is valid, extend validity within 8 hours of expiry, or cancel within 24 hours of generation. Other details cannot be changed — cancel and generate a new bill instead.' },
  { q: 'What does “Ready to generate” mean?', a: 'The invoice passed our checks and is waiting for your review. Nothing is sent until you confirm on the review screen.' },
  { q: 'Is PDF import accurate?', a: 'It reads the text in your PDF and suggests values with a confidence tag. Always check each field — scanned images without selectable text cannot be read.' },
  { q: 'Why do I see “Sandbox”?', a: 'The app is connected to a test provider. Bills it returns are not valid for moving goods. Your administrator connects a licensed GSP for live use.' },
  { q: 'Does the app file my GST returns?', a: 'No. It shows the filing status reported by your GST data provider. File returns on the GST portal or through your tax professional.' },
];

const PRIVACY = [
  ['Your account', 'Sign-in is handled by Firebase Authentication. We never see or store your password.'],
  ['Your business data', 'Invoices and saved details are stored on your device and synced to your private workspace. Other users cannot read them.'],
  ['PDF imports', 'PDFs are processed in memory on our server to suggest values and are not stored.'],
  ['Government portals', 'We never ask for your GST or e-way bill portal password or OTP. Provider credentials stay on our servers.'],
  ['Deletion & export', 'Export everything from Account › Export my data. Request deletion from Account; records the law requires us to keep are retained only for that period.'],
];

export default function HelpScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const store = useAppStore();
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={section === 'privacy' ? 'Privacy & terms' : 'Help & support'} />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
        {section !== 'privacy' ? (
          <>
            <Card style={{ padding: 0, gap: 0 }}>
              {FAQ.map((item, index) => (
                <React.Fragment key={item.q}>
                  {index ? <Divider /> : null}
                  <Pressable onPress={() => setOpenIndex(openIndex === index ? null : index)} style={styles.faq} accessibilityRole="button" accessibilityState={{ expanded: openIndex === index }}>
                    <View style={styles.faqHead}>
                      <TextBlock size={14} weight="semibold" style={{ flex: 1 }}>{item.q}</TextBlock>
                      <Feather name={openIndex === index ? 'minus' : 'plus'} size={17} color={colors.primary} />
                    </View>
                    {openIndex === index ? <TextBlock size={13} color={colors.mutedForeground} style={{ lineHeight: 20 }}>{item.a}</TextBlock> : null}
                  </Pressable>
                </React.Fragment>
              ))}
            </Card>
            <Card>
              <TextBlock size={15} weight="semibold">Still need help?</TextBlock>
              <TextBlock size={13} color={colors.mutedForeground}>Write to us with your invoice number or bill number (never your passwords).</TextBlock>
              {SUPPORT_EMAIL ? <Button title="Email support" icon="mail" onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Help%20with%20EWB%20Vendor%20App`)} /> : <TextBlock size={12} color={colors.warningForeground}>Support email is not configured yet (EXPO_PUBLIC_SUPPORT_EMAIL).</TextBlock>}
            </Card>
            <Card>
              <TextBlock size={15} weight="semibold">Service status</TextBlock>
              <KeyValue label="Connection" value={store.online === false ? 'Offline' : store.online ? 'Online' : 'Checking…'} />
              <KeyValue label="E-way bill provider" value={store.config?.ewbProvider?.label ?? 'Not configured'} />
              <KeyValue label="GST status provider" value={store.config?.gstProvider?.label ?? 'Not configured'} />
              <KeyValue label="Service" value={API_BASE.replace(/^https?:\/\//, '')} />
              <View style={{ flexDirection: 'row' }}><StatusPill label={store.config?.authMode === 'firebase' ? 'Secure sign-in' : 'Sandbox workspace'} tone={store.config?.authMode === 'firebase' ? 'green' : 'amber'} /></View>
            </Card>
          </>
        ) : null}
        <Card>
          <TextBlock size={15} weight="semibold">How we handle your data</TextBlock>
          {PRIVACY.map(([title, body]) => (
            <View key={title} style={{ gap: 3 }}>
              <TextBlock size={13} weight="semibold">{title}</TextBlock>
              <TextBlock size={13} color={colors.mutedForeground} style={{ lineHeight: 19 }}>{body}</TextBlock>
            </View>
          ))}
          <TextBlock size={11} color={colors.mutedForeground}>Invoice layouts are presentation templates, not government-approved formats. E-way bill rules summarised here are general guidance, not legal advice.</TextBlock>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  faq: { padding: 16, gap: 8, minHeight: 56 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
