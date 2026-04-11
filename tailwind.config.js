/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./templates/**/*.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        indigo: {
          50: '#f4f6f9',
          100: '#e8edf4',
          200: '#c5d2e3',
          300: '#92abcd',
          400: '#5a7eb0',
          500: '#376092',
          600: '#11254b', // Primary: Dark Navy
          700: '#0d1c3a', // Hover: Darker Navy
          800: '#09152b',
          900: '#060e1d',
          950: '#04070e',
        },
        orange: {
          50: '#fef5f4',
          100: '#fee9e6',
          200: '#fcd0c9',
          300: '#faa99d',
          400: '#f67362',
          500: '#f04933',
          600: '#ef3c23', // Primary: Bright Orange
          700: '#c92d18',
          800: '#a62716',
          900: '#892517',
          950: '#4a0f08',
        }
      }
    },
  },
  plugins: [],
}
