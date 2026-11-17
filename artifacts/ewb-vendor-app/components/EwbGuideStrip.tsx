import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, TextBlock } from '@/components/AppUI';
import { GuideImage } from '@/components/GuideImage';
import { useColors } from '@/hooks/useColors';
import { GUIDE_STEPS } from '@/lib/ewb-guide';

/** The API login steps with their pictures, swiped sideways (support chat). */
export function EwbGuideStrip() {
  const colors = useColors();
  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
        {GUIDE_STEPS.map((step, index) => (
          <View key={step.title} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.head}>
              <View style={[styles.num, { backgroundColor: colors.primary }]}><TextBlock size={12} weight="bold" color={colors.primaryForeground}>{index + 1}</TextBlock></View>
              <TextBlock size={13} weight="bold" style={{ flex: 1 }} numberOfLines={2}>{step.title}</TextBlock>
            </View>
            {step.image ? <GuideImage source={step.image} label={step.title} height={120} /> : null}
            {step.points.map((point) => <TextBlock key={point} size={12} color={colors.mutedForeground}>• {point}</TextBlock>)}
          </View>
        ))}
      </ScrollView>
      <TextBlock size={11} color={colors.mutedForeground}>Swipe to see all steps · tap a picture to zoom</TextBlock>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Full guide" icon="book-open" size="sm" variant="outline" onPress={() => router.push('/ewb-setup')} style={{ flex: 1 }} />
        <Button title="Enter API login" icon="key" size="sm" onPress={() => router.push({ pathname: '/ewb-setup', params: { step: String(GUIDE_STEPS.length + 1) } })} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: 250, borderWidth: 1, borderRadius: 14, padding: 10, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
