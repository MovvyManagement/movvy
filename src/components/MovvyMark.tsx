// =============================================================================
// MovvyMark — the official Movvy brand mark (bare / transparent truck)
//
// The bright-green delivery truck carrying the lowercase "movvy" wordmark, with
// NO tile behind it — the transparent treatment from the brand sheet. Drop it on
// any light or charcoal surface; on a green surface pass variant="reversed" to
// flip the truck white.
//
// Renders via react-native-svg so it stays crisp at any size, makes no network
// request, and ships in the JS bundle. Used in:
//   • Welcome screen lockup
//   • Live-tracking + chat headers
//   • The "Moves" tab-bar icon
//
// The mark is naturally wide (~2:1). `size` is the mark HEIGHT in px; width is
// derived from the artwork's aspect ratio. The cargo wordmark is hidden below
// ~32px tall, where it would render as an illegible smudge — the truck
// silhouette alone still reads as "moving company".
// =============================================================================

import React from 'react';
import { View } from 'react-native';
import Svg, { Rect, Circle, Path, Text as SvgText } from 'react-native-svg';

interface Props {
  /** Mark height in px, or a preset. Width scales with the artwork aspect. */
  size?: 'sm' | 'md' | 'lg' | number;
  /** Flip the truck to white for placement on a green surface. */
  variant?: 'default' | 'reversed';
  /**
   * @deprecated The mark now carries the "movvy" wordmark on the cargo, so a
   * separate text label is redundant. Kept so existing call sites still type-
   * check; it has no visual effect.
   */
  showText?: boolean;
}

const SIZES = { sm: 24, md: 32, lg: 44 };

// Artwork bounding box (see the brand sheet's transparent variant): the content
// spans x:[-8..145] and y:[8..86]. Everything below is authored in that space.
const VB_MIN_X = -8;
const VB_MIN_Y = 8;
const VB_W = 153;
const VB_H = 78;
const ASPECT = VB_W / VB_H; // ≈ 1.96

// Rounded-rect path with per-corner radii [tl, tr, br, bl]; a 0 radius emits a
// straight corner. react-native-svg's <Rect> only does uniform rx, so the
// truck's asymmetric corners (cab, wheel arches) are drawn as paths.
function rr(x: number, y: number, w: number, h: number, radii: [number, number, number, number]) {
  const [tl, tr, br, bl] = radii;
  const p = [`M${x + tl},${y}`, `H${x + w - tr}`];
  if (tr) p.push(`A${tr},${tr} 0 0 1 ${x + w},${y + tr}`);
  p.push(`V${y + h - br}`);
  if (br) p.push(`A${br},${br} 0 0 1 ${x + w - br},${y + h}`);
  p.push(`H${x + bl}`);
  if (bl) p.push(`A${bl},${bl} 0 0 1 ${x},${y + h - bl}`);
  p.push(`V${y + tl}`);
  if (tl) p.push(`A${tl},${tl} 0 0 1 ${x + tl},${y}`);
  p.push('Z');
  return p.join(' ');
}

export function MovvyMark({ size = 'sm', variant = 'default' }: Props) {
  const height = typeof size === 'number' ? size : SIZES[size];
  const width = height * ASPECT;

  const reversed = variant === 'reversed';
  const GREEN = '#0FA353';
  const GREEN_DEEP = '#0A7A3E';
  const INK = '#282B2A';

  // Default: green truck, white body detail. Reversed: white truck for a green
  // surface, with the wordmark + window switched to green so they read.
  const body = reversed ? '#FFFFFF' : GREEN;
  const underside = reversed ? 'rgba(40,43,42,0.25)' : GREEN_DEEP;
  const word = reversed ? GREEN : '#FFFFFF';
  const windowFill = reversed ? GREEN : INK;
  const hub = reversed ? INK : '#FFFFFF';
  const speed = reversed ? '#FFFFFF' : GREEN;

  const showWord = height >= 32;

  return (
    <View accessibilityRole="image" accessibilityLabel="Movvy">
      <Svg width={width} height={height} viewBox={`${VB_MIN_X} ${VB_MIN_Y} ${VB_W} ${VB_H}`}>
        {/* motion speed lines */}
        <Rect x={8} y={34} width={17} height={8} rx={4} fill={speed} />
        <Rect x={0} y={47} width={24} height={8} rx={4} fill={speed} />
        <Rect x={-8} y={60} width={32} height={8} rx={4} fill={speed} />

        {/* cargo body + underside */}
        <Rect x={30} y={8} width={78} height={56} rx={9} fill={body} />
        <Path d={rr(30, 55, 78, 9, [0, 0, 9, 9])} fill={underside} />
        {showWord ? (
          <SvgText
            x={69}
            y={44}
            textAnchor="middle"
            fill={word}
            fontWeight="900"
            fontSize={22}
            letterSpacing={-1}
          >
            movvy
          </SvgText>
        ) : null}

        {/* cab + window + headlight */}
        <Path d={rr(108, 26, 37, 38, [6, 10, 6, 6])} fill={body} />
        <Path d={rr(108, 55, 37, 9, [0, 0, 6, 6])} fill={underside} />
        <Path d={rr(116, 32, 20, 17, [2, 8, 2, 2])} fill={windowFill} />
        <Path d={rr(140, 49, 5, 8, [0, 2, 2, 0])} fill={underside} />

        {/* wheels — dark-green arch + light hub */}
        <Path d={rr(45, 62, 28, 14, [14, 14, 0, 0])} fill={underside} />
        <Path d={rr(112, 62, 28, 14, [14, 14, 0, 0])} fill={underside} />
        <Circle cx={59.5} cy={75.5} r={10.5} fill={hub} />
        <Circle cx={126.5} cy={75.5} r={10.5} fill={hub} />
      </Svg>
    </View>
  );
}
