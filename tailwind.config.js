export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      screens: {
        xs: '420px',
        sm: '480px',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
