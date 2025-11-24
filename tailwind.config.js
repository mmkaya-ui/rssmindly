/** @type {import('tailwindcss').Config} */
export default {
  // 1. This line is the fix. It tells Tailwind to look for className="dark"
  darkMode: 'class', 
  
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'), // Ensure you have this for the article formatting
  ],
}