/** @type {import('tailwindcss').Config} */
// Neutral tokens (ink/silver) mirror the mobile app. The green is the refreshed
// 2026-08 brand and intentionally diverges from the mobile app now.
//
// Two green scales on purpose:
//  • brand-*  (public marketing site) — the mid-band 500/600/700 all collapse to
//    the EXACT logo green #0FA353, so every green on the page matches the
//    wordmark. 800/900 keep the deep greens (unused on marketing today).
//  • emerald-* (admin ops console) — a graduated ramp so badge text
//    (emerald-700/800 on light emerald-50/100 fills) keeps enough contrast.
const brand = {
  50: '#E9F7EF',
  100: '#CFEFDD',
  200: '#A3E0BF',
  300: '#6BCB99',
  400: '#33B473',
  500: '#0FA353',
  600: '#0FA353',
  700: '#0FA353',
  800: '#0A7A3E',
  900: '#086433',
  DEFAULT: '#0FA353',
};

const emerald = {
  50: '#E9F7EF',
  100: '#CFEFDD',
  200: '#A3E0BF',
  300: '#6BCB99',
  400: '#33B473',
  500: '#0FA353',
  600: '#0C9049',
  700: '#0A7A3E',
  800: '#086433',
  900: '#064E28',
  DEFAULT: '#0FA353',
};

module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
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
        brand,
        emerald,
        success: '#0FA353',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
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
