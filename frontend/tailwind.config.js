/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Segoe UI", "Arial", "sans-serif"]
      },
      colors: {
        ink: "#17202a",
        line: "#d9dee6",
        panel: "#f7f9fb",
        green: {
          nms: "#1f9d55"
        },
        orange: {
          nms: "#d97706"
        },
        red: {
          nms: "#dc2626",
          dark: "#991b1b"
        }
      }
    }
  },
  plugins: []
};

