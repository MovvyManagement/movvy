// =============================================================================
// MovvyMark — the official Movvy brand mark
//
// Truck + location-pin design on a rounded green tile. Matches the same SVG
// used on the landing page (web/components/Logo.tsx) so app screenshots
// share the visual identity with movvy.ca.
//
// Renders via react-native-svg so it stays crisp at any size, has no
// network request, and ships with the JS bundle. Used in:
//   • Live tracking screen header (next to SOS / Customer Service)
//   • Chat sheet header
//   • Welcome screen
//   • Move-history list rows
// =============================================================================

import React from 'react';
import { View, Text } from 'react-native';
import Svg, {
  Rect,
  Line,
  Circle,
  Path,
  Text as SvgText,
} from 'react-native-svg';

interface Props {
  size?: 'sm' | 'md' | 'lg' | number;
  showText?: boolean;
  /** Subtle variant for tighter headers — outline tile with green fill on the truck. */
  variant?: 'filled' | 'tint';
}

const SIZES = { sm: 28, md: 36, lg: 44 };

export function MovvyMark({ size = 'sm', showText = false, variant = 'filled' }: Props) {
  const dim = typeof size === 'number' ? size : SIZES[size];
  const textSize = dim < 32 ? 'text-sm' : dim < 42 ? 'text-base' : 'text-xl';

  // Tint variant keeps the tile faint and inverts the truck colors so the
  // mark reads on light/white containers without competing for attention.
  const tileFill = variant === 'filled' ? '#0E9F6E' : '#ECFDF5';
  const truckFill = variant === 'filled' ? '#FFFFFF' : '#0E9F6E';
  const wordFill = variant === 'filled' ? '#047857' : '#FFFFFF';
  const pinDotFill = variant === 'filled' ? '#0E9F6E' : '#ECFDF5';

  return (
    <View className="flex-row items-center">
      <Svg width={dim} height={dim} viewBox="0 0 100 100">
        {/* Rounded green tile */}
        <Rect width={100} height={100} rx={22} fill={tileFill} />

        {/* Motion lines on the far left */}
        <Line
          x1={5}
          y1={52}
          x2={14}
          y2={52}
          stroke={truckFill}
          strokeOpacity={0.45}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
        <Line
          x1={7}
          y1={58}
          x2={16}
          y2={58}
          stroke={truckFill}
          strokeOpacity={0.45}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
        <Line
          x1={9}
          y1={64}
          x2={18}
          y2={64}
          stroke={truckFill}
          strokeOpacity={0.45}
          strokeWidth={2.6}
          strokeLinecap="round"
        />

        {/* Cargo box body + divider stripe */}
        <Rect x={20} y={40} width={38} height={35} rx={3.5} fill={truckFill} />
        <Line x1={39} y1={40} x2={39} y2={75} stroke="#D1FAE5" strokeWidth={1.5} />

        {/* Wordmark — hidden at very small sizes where it'd be illegible */}
        {dim >= 24 ? (
          <SvgText
            x={39.5}
            y={62}
            textAnchor="middle"
            fill={wordFill}
            fontWeight="800"
            fontSize={9.5}
            fontFamily="Helvetica"
          >
            Movvy
          </SvgText>
        ) : null}

        {/* Cab + windshield + headlight */}
        <Path d="M58 50 L75 50 L80 60 L80 75 L58 75 Z" fill={truckFill} />
        <Path d="M62 53 L73 53 L76 60 L62 60 Z" fill="#A7F3D0" />
        <Circle cx={78} cy={64} r={1.6} fill="#FBBF24" />

        {/* Wheels — outer tire + inner hub */}
        <Circle cx={32} cy={78} r={6.2} fill="#1F2937" />
        <Circle cx={32} cy={78} r={2.6} fill="#9CA3AF" />
        <Circle cx={70} cy={78} r={6.2} fill="#1F2937" />
        <Circle cx={70} cy={78} r={2.6} fill="#9CA3AF" />

        {/* Bumper / ground stripe */}
        <Rect x={18} y={73} width={64} height={2.5} rx={1} fill="#A7F3D0" />

        {/* Location pin — top-right */}
        <Circle cx={76} cy={22} r={10} fill={truckFill} />
        <Path d="M76 32 L72 38 L80 38 Z" fill={truckFill} />
        <Circle cx={76} cy={22} r={4.2} fill={pinDotFill} />
      </Svg>
      {showText ? (
        <Text className={`ml-2 ${textSize} font-bold text-ink-900`}>Movvy</Text>
      ) : null}
    </View>
  );
}
