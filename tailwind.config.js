/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    borderRadius: { none: '0', sm: '6px', DEFAULT: '10px', md: '10px', lg: '14px', xl: '18px', '2xl': '22px', '3xl': '28px', full: '9999px' },
    extend: {
      colors: {
        // Все цвета — переменные: светлая и тёмная темы переключаются атрибутом data-theme (см. style.css).
        night: { 950: v('bg'), 900: v('inset'), 800: v('card'), 700: v('raised'), 600: v('line') },
        ink: v('ink'), soft: v('soft'), mute: v('mute'), faint: v('faint'),
        accent: { DEFAULT: v('accent'), glow: v('accent-glow'), soft: v('accent-soft'), on: v('on-accent') },
        ok: v('ok'), warn: v('warn'), bad: v('bad'),
      },
      boxShadow: { card: '0 1px 0 rgb(255 255 255 / 0.03) inset, 0 8px 24px rgb(var(--shadow) / 0.28)' },
      fontFamily: {
        sans: ['Roboto', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['Roboto', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
