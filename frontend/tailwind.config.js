/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0e17',
        surface: '#111827',
        surface2: '#1a2235',
        border: '#1e2d40',
        text: '#e2e8f0',
        muted: '#64748b',
        brand: '#06b6d4',
        profit: '#10b981',
        loss: '#ef4444',
        warning: '#f59e0b',
        purple: '#8b5cf6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
        input: '8px',
        pill: '6px',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
