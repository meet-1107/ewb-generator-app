import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TextBlock } from '@/components/AppUI';
import { useColors } from '@/hooks/useColors';

/** Strokes drawn with a finger, as SVG path data in the pad's own coordinates. */
export type Strokes = { paths: string[]; width: number; height: number };

const round = (value: number) => Math.round(value * 10) / 10;

/** Room to draw comfortably with a finger. */
export const PAD_HEIGHT = 300;

const POINT = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g;

/**
 * Trims the empty pad around the strokes, so the saved signature fills the
 * signatory box on the invoice however small it was drawn on the big pad.
 */
export function cropStrokes({ paths, width, height }: Strokes, margin = 6): Strokes {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of paths) for (const [, x, y] of d.matchAll(POINT)) { xs.push(Number(x)); ys.push(Number(y)); }
  if (!xs.length) return { paths, width, height };
  const left = Math.max(0, Math.min(...xs) - margin);
  const top = Math.max(0, Math.min(...ys) - margin);
  return {
    paths: paths.map((d) => d.replace(POINT, (_, x, y) => `${round(Number(x) - left)} ${round(Number(y) - top)}`)),
    width: Math.ceil(Math.max(...xs) + margin - left),
    height: Math.ceil(Math.max(...ys) + margin - top),
  };
}

/** A white pad to sign on; `onChange` gets every stroke so far (empty when cleared). */
export function SignaturePad({ strokes, onChange, height = PAD_HEIGHT }: { strokes: string[]; onChange: (next: Strokes) => void; height?: number }) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState('');
  const live = useRef('');
  const latest = useRef({ strokes, width });
  latest.current = { strokes, width };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Keeps the page from scrolling while signing.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      live.current = `M ${round(locationX)} ${round(locationY)}`;
      setCurrent(live.current);
    },
    onPanResponderMove: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      live.current += ` L ${round(locationX)} ${round(locationY)}`;
      setCurrent(live.current);
    },
    onPanResponderRelease: () => {
      const stroke = live.current.includes('L') ? live.current : `${live.current} L ${live.current.split(' ').slice(1).map(Number).map((n) => n + 0.5).join(' ')}`;
      live.current = '';
      setCurrent('');
      onChange({ paths: [...latest.current.strokes, stroke], width: Math.round(latest.current.width), height });
    },
  }), [height, onChange]);

  return (
    <View
      style={[styles.pad, { height, borderColor: colors.border }]}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      {...responder.panHandlers}
    >
      <Svg width="100%" height={height}>
        {[...strokes, current].filter(Boolean).map((d, index) => (
          <Path key={index} d={d} stroke="#1b2420" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </Svg>
      {!strokes.length && !current ? (
        <View style={styles.hint} pointerEvents="none">
          <TextBlock size={13} color="#8a948f">Sign here with your finger</TextBlock>
        </View>
      ) : null}
      <View style={styles.line} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { backgroundColor: '#ffffff', borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  hint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  line: { position: 'absolute', left: 24, right: 24, bottom: 44, borderBottomWidth: 1, borderColor: '#d5d9d6', borderStyle: 'dashed' },
});
