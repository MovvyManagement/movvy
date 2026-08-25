/** @type {import('tailwindcss').Config} */
// Neutral tokens (ink/silver) mirror the mobile app. The green is the refreshed
// 2026-08 brand — primary #0FA353, deep #0A7A3E — and intentionally diverges
// from the mobile app's palette now. One scale backs BOTH `brand-*` (public
// marketing site) and `emerald-*` (the admin ops console), so the entire site
// shares a single green. `success` is the same primary green.
const green = {
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
        brand: green,
        // Admin console (app/admin-management/*) is built on Tailwind's built-in
        // `emerald-*`; overriding it here recolors the whole ops console to the
        // brand green without touching any of those class strings.
        emerald: green,
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
