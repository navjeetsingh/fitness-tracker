/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        midnight: '#0A0E1A',
        panel:    '#111827',
        border:   '#1F2937',
        accent:   '#F97316',
        pulse:    '#EF4444',
        zone2:    '#22D3EE',
        good:     '#4ADE80',
        warn:     '#FBBF24',
        muted:    '#6B7280',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
