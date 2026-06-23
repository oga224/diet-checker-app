/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream:  '#F5F2EE',
        greige: '#EDE8E0',
        navy:   '#1C2951',
        gold:   '#C9A96E',
        'gold-light': '#DEB87A',
      },
      fontFamily: {
        sans:  ['"Noto Sans JP"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
