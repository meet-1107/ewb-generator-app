import React, { useState } from 'react';
import { Image, type ImageSourcePropType, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

/** A marked portal screenshot; a tap opens it full screen (landscape screenshots are small on a phone). */
export function GuideImage({ source, label, height = 190 }: { source: ImageSourcePropType; label: string; height?: number }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={`${label}. Tap to enlarge`} style={({ pressed }) => [styles.frame, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.85 : 1 }]}>
        <Image source={source} style={{ width: '100%', height }} resizeMode="contain" />
        <View style={[styles.zoom, { backgroundColor: colors.primary }]}>
          <Feather name="maximize-2" size={12} color={colors.primaryForeground} />
          <TextBlock size={11} weight="bold" color={colors.primaryForeground}>Tap to zoom</TextBlock>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
        <Pressable style={styles.full} onPress={() => setOpen(false)} accessibilityLabel="Close picture">
          <Image source={source} style={styles.fullImage} resizeMode="contain" />
          <View style={styles.close}><Feather name="x" size={22} color="#fff" /></View>
          <TextBlock size={12} color="#fff" style={{ position: 'absolute', bottom: 40, alignSelf: 'center', opacity: 0.8 }}>Turn the phone sideways for a bigger view · tap to close</TextBlock>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', padding: 4 },
  zoom: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  full: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  fullImage: { width: '100%', height: '80%' },
  close: { position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
