// =============================================================================
// <MaxWidth />
//
// Centres its children at a comfortable max width on tablets / web; renders
// as a normal full-width View on phones. The default width is the
// "form-comfortable" 560 dp — wider feels weird for an app, narrower
// crowds the address-autocomplete dropdown.
//
// Usage:
//   <MaxWidth>
//     <Card>…</Card>
//   </MaxWidth>
//
// For body-text screens (Profile, Help docs) pass `flavour="reading"` to
// get the 640 dp variant.
// =============================================================================

import React from 'react';
import { View, ViewProps } from 'react-native';
import { useResponsiveLayout } from '@/lib/useResponsiveLayout';

interface Props extends ViewProps {
  flavour?: 'form' | 'reading';
  /** Override the auto-calculated max width. */
  maxWidth?: number;
}

export function MaxWidth({
  children,
  flavour = 'form',
  maxWidth,
  style,
  ...rest
}: Props) {
  const layout = useResponsiveLayout();
  const computed =
    maxWidth ??
    (flavour === 'reading' ? layout.readingMaxWidth : layout.contentMaxWidth);

  // On phones the helper returns undefined → render a no-op wrapper that
  // doesn't disturb existing flex layouts.
  if (!computed) {
    return (
      <View style={style} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <View style={[{ width: '100%', alignItems: 'center' }, style]} {...rest}>
      <View style={{ width: '100%', maxWidth: computed }}>{children}</View>
    </View>
  );
}
