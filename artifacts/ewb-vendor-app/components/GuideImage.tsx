import React, { useState } from 'react';
import { Image, type ImageSourcePropType, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;

/** A marked portal screenshot; a tap opens it full screen, where it can be pinched or double-tapped to zoom and dragged. */
export function GuideImage({ source, label, height = 190 }: { source: ImageSourcePropType; label: string; height?: number }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={`${label}. Tap to open and zoom`} style={({ pressed }) => [styles.frame, { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.85 : 1 }]}>
        <Image source={source} style={{ width: '100%', height }} resizeMode="contain" />
        <View style={[styles.zoom, { backgroundColor: colors.primary }]}>
          <Feather name="zoom-in" size={12} color={colors.primaryForeground} />
          <TextBlock size={11} weight="bold" color={colors.primaryForeground}>Tap to zoom</TextBlock>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
        {/* Gestures inside a Modal need their own root on Android. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
          {open ? <ZoomView source={source} onClose={() => setOpen(false)} /> : null}
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

function ZoomView({ source, onClose }: { source: ImageSourcePropType; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  // Keeps the zoomed picture from being dragged off the screen.
  const clamp = (value: number, limit: number) => {
    'worklet';
    return Math.min(Math.max(value, -limit), limit);
  };
  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    x.value = withTiming(0);
    y.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), MAX_ZOOM);
    })
    .onEnd(() => {
      if (scale.value <= 1.02) reset();
      else {
        savedScale.value = scale.value;
        x.value = clamp(x.value, ((scale.value - 1) * width) / 2);
        y.value = clamp(y.value, ((scale.value - 1) * height) / 2);
        savedX.value = x.value;
        savedY.value = y.value;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((event) => {
      if (scale.value <= 1) return;
      x.value = clamp(savedX.value + event.translationX, ((scale.value - 1) * width) / 2);
      y.value = clamp(savedY.value + event.translationY, ((scale.value - 1) * height) / 2);
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) reset();
      else {
        scale.value = withTiming(DOUBLE_TAP_ZOOM);
        savedScale.value = DOUBLE_TAP_ZOOM;
      }
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));

  return (
    <View style={styles.full}>
      <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
        <Animated.View style={[{ width, height, justifyContent: 'center' }, style]}>
          <Image source={source} style={{ width, height }} resizeMode="contain" />
        </Animated.View>
      </GestureDetector>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close picture" hitSlop={12} style={[styles.close, { top: insets.top + 12 }]}>
        <Feather name="x" size={24} color="#fff" />
      </Pressable>
      <View pointerEvents="none" style={[styles.hint, { bottom: insets.bottom + 24 }]}>
        <Feather name="maximize" size={14} color="#fff" />
        <TextBlock size={12} color="#fff">Pinch or double-tap to zoom · drag to move · turn the phone for a bigger view</TextBlock>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', padding: 4 },
  zoom: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  full: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  close: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  hint: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginHorizontal: 16 },
});
