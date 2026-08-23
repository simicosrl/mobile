/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: '#1F6FEB',
          400: '#3B82F6',
          600: '#1D4ED8',
          dark: '#0969DA',
        },
        navy: '#0B378E',
        accent: {
          DEFAULT: '#FF7A00',
          dark: '#E85D00',
        },
        ink: '#0F172A',
        secondary: '#64748B',
        light: '#94A3B8',
        page: '#f8fafc',
        inputborder: '#e2e8f0',
        success: {
          DEFAULT: '#16A34A',
          tint: '#DCFCE7',
          tint2: '#F0FDF4',
          dark: '#15803D',
        },
        danger: {
          DEFAULT: '#DC2626',
          dark: '#B91C1C',
          tint: '#FEE2E2',
          tint2: '#FEF2F2',
        },
        disabled: '#CBD5E1',
        segtrack: '#eef2f7',
      },
      keyframes: {
        flashOk: { '0%': { background: '#DCFCE7' }, '100%': { background: '#fff' } },
        flashBad: { '0%': { background: '#FEE2E2' }, '100%': { background: '#fff' } },
        fadeUp: { from: { opacity: 0, transform: 'translateY(14px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
      animation: {
        flashOk: 'flashOk .7s ease-out',
        flashBad: 'flashBad .7s ease-out',
        fadeUp: 'fadeUp .22s ease-out',
        fadeUpSlow: 'fadeUp .35s ease-out',
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,.06)',
        seg: '0 1px 2px rgba(15,23,42,.12)',
        toast: '0 12px 30px rgba(0,0,0,.3)',
        focusring: '0 0 0 3px rgba(31,111,235,.12)',
      },
    },
  },
  plugins: [],
};
