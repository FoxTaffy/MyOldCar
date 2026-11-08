/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        night: { 950: '#05070d', 900: '#0a0f1c', 800: '#101828', 700: '#1a2438', 600: '#26334d' },
        accent: { DEFAULT: '#3b82f6', glow: '#60a5fa' },
      },
      fontFamily: { mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
}
