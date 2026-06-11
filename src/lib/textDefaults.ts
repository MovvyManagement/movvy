// =============================================================================
// Text + TextInput default props
//
// iOS Dynamic Type scales fonts up to ~3.6× for accessibility users. Most of
// the Movvy layout fits 1.5× cleanly; past that, badges + chips overflow.
// Capping `maxFontSizeMultiplier` at 1.5 keeps the layout intact while still
// honouring users who request larger system text.
//
// This file runs as a module-level side effect — imported once from
// app/_layout.tsx before any Text mounts. Components that need a different
// cap (e.g. badges should never grow past 1.2) can set the prop directly.
// =============================================================================

import { Text, TextInput } from 'react-native';

const Defaults = {
  // 1.5× covers all but the largest Dynamic Type settings. Past that the
  // user's text is technically clipped but every Movvy CTA still tappable.
  maxFontSizeMultiplier: 1.5,
};

interface MutableComponent {
  defaultProps?: Record<string, any>;
}

// `defaultProps` is a deprecated escape hatch on functional components but
// still works for native primitives (Text + TextInput). Until RN gives us
// a first-class way to set defaults globally, this is the canonical path.
(Text as unknown as MutableComponent).defaultProps = {
  ...((Text as unknown as MutableComponent).defaultProps ?? {}),
  ...Defaults,
};
(TextInput as unknown as MutableComponent).defaultProps = {
  ...((TextInput as unknown as MutableComponent).defaultProps ?? {}),
  ...Defaults,
};
