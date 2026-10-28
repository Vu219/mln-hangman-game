/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        blood: { 950: "#1a0204", 900: "#2b0508", 800: "#4a0a0f", 700: "#6e0e16", 600: "#93131d", 500: "#b91c25", 400: "#dc3a3a" },
        gold: { 600: "#c8901a", 500: "#e8b021", 400: "#f5c84c", 300: "#fbe08a" },
        coal: { 950: "#070606", 900: "#0f0d0d", 800: "#1a1616", 700: "#2a2323", 600: "#3d3434" },
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', "system-ui", "sans-serif"],
        display: ['"Bungee"', '"Be Vietnam Pro"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
