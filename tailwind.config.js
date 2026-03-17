/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}"],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'sans-serif'] },
      colors: {
          dark: '#202124',
          meetBlue: '#8ab4f8',
          meetRed: '#ea4335',
          meetGray: '#3c4043'
      }
    },
  },
  plugins: [],
}
