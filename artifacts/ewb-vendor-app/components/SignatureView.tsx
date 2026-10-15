import React from 'react';
import { Image, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { type Signature } from '@/lib/domain';

/** A saved signature, drawn at the given height (for previews in the app). */
export function SignatureView({ signature, height = 48 }: { signature: Signature; height?: number }) {
  if (signature.kind === 'image') return <Image source={{ uri: signature.dataUri }} style={{ height, width: height * 3.2 }} resizeMode="contain" />;
  const width = (height * signature.width) / Math.max(signature.height, 1);
  return (
    <View style={{ height, width: Math.min(width, height * 4) }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${signature.width} ${signature.height}`} preserveAspectRatio="xMidYMid meet">
        {signature.paths.map((d, index) => <Path key={index} d={d} stroke="#1b2420" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
      </Svg>
    </View>
  );
}
