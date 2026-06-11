/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Locked to light mode app-wide. `class` means `dark:` variants only
  // activate when a `.dark` class is on the root — and we never add one,
  // so they're inert. This keeps Movvy on its white/silver/green brand
  // palette regardless of the device's OS Appearance setting. Switch
  // back to 'media' once every screen has dark: variants for bg/text.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0A0A0A',
          900: '#0A0A0A',
          800: '#171717',
          700: '#2A2A2A',
          600: '#404040',
        },
        silver: {
          50: '#FAFAFA',
          100: '#F4F4F5',
          200: '#E4E4E7',
          300: '#D4D4D8',
          400: '#A1A1AA',
          500: '#71717A',
          600: '#52525B',
        },
        // Dark-mode neutrals. Same role as ink/silver but inverted luminance
        // so the contrast ratios match. Used via `dark:bg-night-...` /
        // `dark:text-mist-...` in components.
        night: {
          50: '#1C1C1E',   // primary surface (cards, headers)
          100: '#1E1E22',  // base surface
          200: '#27272A',  // elevated (modals, bottom tabs)
          300: '#33333A',  // borders
          400: '#3F3F46',  // muted borders
          500: '#52525B',  // disabled
          900: '#0B0B0E',  // app background
        },
        mist: {
          50: '#FAFAFA',   // primary text
          100: '#E4E4E7',  // secondary text
          200: '#D4D4D8',  // tertiary text
          300: '#A1A1AA',  // placeholder
          400: '#71717A',
          500: '#52525B',
        },
        brand: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          800: '#065F46',
          900: '#064E3B',
          DEFAULT: '#16A34A',
        },
        success: '#16A34A',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['Inter_400Regular', 'System'],
        medium: ['Inter_500Medium', 'System'],
        semibold: ['Inter_600SemiBold', 'System'],
        bold: ['Inter_700Bold', 'System'],
      },
      borderRadius: {
        xl: '16px',
        '2xl': '20px',
        '3xl': '28px',
      },
    },
  },
  plugins: [],
};
