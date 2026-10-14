import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Sheet, TextBlock } from '@/components/AppUI';
import { useDialog } from '@/components/Dialog';
import { useColors } from '@/hooks/useColors';
import { useAppStore } from '@/state/app-store';

export const EWB_PORTAL_URL = 'https://ewaybillgst.gov.in';

/** NIC portal steps to create the API login (the login the app uses to file bills). */
const STEPS: { title: string; body: string }[] = [
  { title: 'Log in to the e-way bill portal', body: 'Open ewaybillgst.gov.in and sign in with your normal e-way bill username and password.' },
  { title: 'Open Registration → For GSP', body: 'In the left menu choose Registration, then For GSP. Tap Send OTP and enter the OTP sent to your registered mobile.' },
  { title: 'Add a new GSP login', body: 'Choose Add/New and select the GSP "Chartered Information Systems Pvt. Ltd." from the list. Then create a new API username and password. This is different from your normal portal login.' },
  { title: 'Enter it in E-Way Easy', body: 'Come back here and save the API username and password. We check it with the portal before saving it securely.' },
];

/** Numbered steps; used in the guide sheet and on the portal login screen. */
export function EwbLoginSteps() {
  const colors = useColors();
  return (
    <View style={{ gap: 12 }}>
      {STEPS.map((step, index) => (
        <View key={step.title} style={styles.step}>
          <View style={[styles.number, { backgroundColor: colors.primary }]}>
            <TextBlock size={13} weight="bold" color={colors.primaryForeground}>{index + 1}</TextBlock>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <TextBlock size={14} weight="semibold">{step.title}</TextBlock>
            <TextBlock size={12} color={colors.mutedForeground} style={{ lineHeight: 18 }}>{step.body}</TextBlock>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Opens the setup video (link set on the server), or says it is not ready. */
export function useTutorialVideo() {
  const store = useAppStore();
  const dialog = useDialog();
  const url = store.config?.tutorialVideoUrl ?? null;
  const open = async () => {
    if (!url) return dialog.toast(store.online === false ? 'Connect to the internet to watch the tutorial.' : 'The video tutorial is coming soon.', 'default');
    await Linking.openURL(url).catch(() => dialog.toast('Could not open the video.', 'danger'));
  };
  return { available: Boolean(url), open };
}

/**
 * First e-way bill without a saved portal API login: explains the one-time setup,
 * with the video, the portal and the screen to enter the login.
 */
export function EwbLoginGuide({ visible, gstin, onClose }: { visible: boolean; gstin: string; onClose: () => void }) {
  const colors = useColors();
  const video = useTutorialVideo();
  const addLogin = () => {
    onClose();
    router.push({ pathname: '/ewb-login', params: { gstin, from: 'ewb' } });
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="One-time setup before your first e-way bill"
      subtitle={gstin ? `E-way bill portal API login for ${gstin}` : 'E-way bill portal API login'}
      footer={
        <View style={{ gap: 10 }}>
          <Button title="I have it — enter API login" icon="key" onPress={addLogin} testID="guide-add-login" />
          <Button title="Open e-way bill portal" icon="external-link" variant="outline" onPress={() => void Linking.openURL(EWB_PORTAL_URL)} testID="guide-open-portal" />
        </View>
      }
    >
      <View style={{ gap: 14, paddingHorizontal: 18 }}>
        <TextBlock size={13} color={colors.mutedForeground} style={{ lineHeight: 19 }}>
          E-Way Easy files e-way bills on the government portal using an API login that you create once for each GSTIN. It takes about 5 minutes, and your first GSTIN gets free credits to try it.
        </TextBlock>
        <Card onPress={() => void video.open()} accessibilityLabel="Watch the setup video" style={{ ...styles.video, backgroundColor: colors.primary }}>
          <View style={styles.play}><TextBlock size={20} color={colors.primary}>▶</TextBlock></View>
          <View style={{ flex: 1 }}>
            <TextBlock size={15} weight="bold" color={colors.primaryForeground}>Watch the setup video</TextBlock>
            <TextBlock size={12} color={colors.primaryForeground} style={{ opacity: 0.85 }}>See each step on the portal, then follow along</TextBlock>
          </View>
        </Card>
        <EwbLoginSteps />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  number: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  video: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 0 },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
});
