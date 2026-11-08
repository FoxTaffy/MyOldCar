/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    borderRadius: { none: '0', sm: '3px', DEFAULT: '3px' },
    extend: {
      colors: {
        // Нейтральный графит с лёгким синим подтоном; без градиентов и свечения.
        night: { 950: '#090b0f', 900: '#0d1015', 800: '#12161d', 700: '#1a202a', 600: '#262e3b' },
        accent: { DEFAULT: '#4a86c8', glow: '#7fb0e6' },
        ok: '#5fae7a', warn: '#d6a23f', bad: '#d9594c',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
