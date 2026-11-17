import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

const STEPS = [
  { title: 'Encrypting your password', detail: 'It never leaves the server unencrypted' },
  { title: 'Checking with the e-way bill portal', detail: 'The government portal can take up to 30 seconds' },
  { title: 'Saving your login', detail: 'Ready for generating e-way bills' },
];

/**
 * Shown while a portal login is saved: the server checks it with the e-way bill
 * portal first, which can be slow, so the user sees what is happening.
 * `done` turns every step green just before the sheet closes.
 */
export function CredentialProgress({ done = false }: { done?: boolean }) {
  const colors = useColors();
  const [seconds, setSeconds] = useState(0);
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    const spinning = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    const pulsing = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    spinning.start();
    pulsing.start();
    // Fills to about 90% over ~30 s; the last part waits for the answer.
    Animated.timing(bar, { toValue: 0.9, duration: 30_000, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => { clearInterval(timer); spinning.stop(); pulsing.stop(); };
  }, [spin, pulse, bar]);

  useEffect(() => {
    if (done) Animated.timing(bar, { toValue: 1, duration: 250, useNativeDriver: false }).start();
  }, [done, bar]);

  // Step 1 is quick; step 2 lasts until the server answers.
  const active = done ? STEPS.length : seconds < 2 ? 0 : 1;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite" accessibilityLabel={done ? 'Login saved' : `${STEPS[Math.min(active, 2)].title}. Please wait.`}>
      <View style={styles.hero}>
        <Animated.View style={[styles.ring, { borderColor: colors.accent, borderTopColor: done ? colors.successForeground : colors.primary, transform: [{ rotate }] }]} />
        <Animated.View style={[styles.core, { backgroundColor: done ? colors.successBackground : colors.accent, transform: [{ scale: done ? 1 : scale }] }]}>
          <Feather name={done ? 'check' : 'shield'} size={30} color={done ? colors.successForeground : colors.primary} />
        </Animated.View>
      </View>
      <TextBlock size={17} weight="bold" style={{ textAlign: 'center' }}>{done ? 'Login saved' : 'Securing your portal login'}</TextBlock>
      <TextBlock size={12} color={colors.mutedForeground} style={{ textAlign: 'center' }}>{done ? 'You can generate e-way bills now.' : `Please keep the app open · ${seconds}s`}</TextBlock>

      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <Animated.View style={[styles.fill, { backgroundColor: done ? colors.successForeground : colors.primary, width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>

      <View style={{ gap: 12, alignSelf: 'stretch' }}>
        {STEPS.map((step, index) => {
          const state = index < active ? 'done' : index === active ? 'active' : 'waiting';
          return (
            <View key={step.title} style={styles.step}>
              <View style={[styles.dot, {
                backgroundColor: state === 'done' ? colors.successForeground : state === 'active' ? colors.primary : 'transparent',
                borderColor: state === 'waiting' ? colors.input : 'transparent',
              }]}>
                {state === 'done' ? <Feather name="check" size={13} color={colors.card} /> : state === 'active' ? <Animated.View style={{ transform: [{ rotate }] }}><Feather name="loader" size={13} color={colors.primaryForeground} /></Animated.View> : null}
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <TextBlock size={14} weight={state === 'active' ? 'bold' : 'semibold'} color={state === 'waiting' ? colors.mutedForeground : colors.foreground}>{step.title}</TextBlock>
                {state === 'active' ? <TextBlock size={12} color={colors.mutedForeground}>{index === 1 && seconds > 20 ? 'Still waiting for the portal. Almost there…' : step.detail}</TextBlock> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 8 },
  hero: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 4 },
  core: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 3, overflow: 'hidden', marginVertical: 6 },
  fill: { height: 6, borderRadius: 3 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
