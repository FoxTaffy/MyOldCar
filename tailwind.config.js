/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    borderRadius: { none: '0', sm: '3px', DEFAULT: '5px', md: '5px', lg: '6px', xl: '8px', '2xl': '8px', '3xl': '10px', full: '9999px' },
    extend: {
      colors: {
        // Все цвета — переменные: светлая и тёмная темы переключаются атрибутом data-theme (см. style.css).
        night: { 950: v('bg'), 900: v('inset'), 800: v('card'), 700: v('raised'), 600: v('line') },
        ink: v('ink'), soft: v('soft'), mute: v('mute'), faint: v('faint'),
        accent: { DEFAULT: v('accent'), glow: v('accent-glow'), soft: v('accent-soft'), on: v('on-accent') },
        ok: v('ok'), warn: v('warn'), bad: v('bad'),
      },
      boxShadow: { card: '0 1px 2px rgb(var(--shadow) / 0.12)' },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        condensed: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
