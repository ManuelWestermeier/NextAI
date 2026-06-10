/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        hard: '0 0 0 1px rgb(39 39 42 / 1), 0 18px 60px rgba(0,0,0,.45)'
      }
    }
  },
  plugins: []
};
