import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';
import { useReviewPrompt } from '@/hooks/useReviewPrompt';
import { openPlayStore } from '@/lib/play-store';
import { useAuth } from '@/state/auth';
import { useAppStore } from '@/state/app-store';

/**
 * "Rate us" from the bottom of the screen after the second e-way bill. A neutral ask
 * (Play policy: no star gate before the store); "Rate now" opens the Play Store page.
 */
export default function RatePrompt() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const store = useAppStore();
  const prompt = useReviewPrompt(store.ewbs.length, Boolean(auth.signedIn && !auth.previewMode && store.business));

  const rate = () => {
    prompt.rated();
    void openPlayStore(store.config?.androidUpdate?.storeUrl).catch(() => undefined);
  };

  return (
    <Modal visible={prompt.visible} transparent animationType="slide" onRequestClose={prompt.later} statusBarTranslucent>
      <View style={styles.wrap}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={prompt.later} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.elevated, borderColor: colors.border, paddingBottom: insets.bottom + 18 }]}>
          <View style={[styles.grabber, { backgroundColor: colors.input }]} />
          <View style={[styles.icon, { backgroundColor: colors.warmAccentSoft }]}>
            <Feather name="star" size={30} color={colors.warmAccent} />
          </View>
          <View style={styles.stars}>
            {[0, 1, 2, 3, 4].map((index) => <Feather key={index} name="star" size={22} color={colors.warmAccent} />)}
          </View>
          <TextBlock size={20} weight="bold" style={{ textAlign: 'center' }}>Your e-way bills are done!</TextBlock>
          <TextBlock size={14} color={colors.mutedForeground} style={{ textAlign: 'center' }}>
            If E-Way Easy saves you time, please rate us on the Play Store. It helps other businesses find us.
          </TextBlock>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 6 }}>
            <Button title="Rate now" icon="star" onPress={rate} testID="rate-now" />
            <Button title="Maybe later" variant="ghost" onPress={prompt.later} testID="rate-later" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 22, paddingTop: 10, alignItems: 'center', gap: 10 },
  grabber: { width: 44, height: 5, borderRadius: 3, marginBottom: 8 },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  stars: { flexDirection: 'row', gap: 4 },
});
