/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff1f1",
          100: "#ffe0e0",
          200: "#ffc5c5",
          300: "#ff9b9b",
          400: "#ff5f5f",
          500: "#ff2a2a",
          600: "#ef1313",
          700: "#c50c0c",
          800: "#a20f0f",
          900: "#861414",
          950: "#4a0404",
        },
      },
      fontFamily: {
        display: ["'Orbitron'", "system-ui", "sans-serif"],
        sans: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      animation: {
        "gradient-x": "gradient-x 8s ease infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "float": "float 6s ease-in-out infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
        "scan": "scan 3s linear infinite",
        "marquee": "marquee 30s linear infinite",
        "marquee-slow": "marquee 150s linear infinite",
      },
      keyframes: {
        "gradient-x": {
          "0%, 100%": { "background-position": "0% 50%" },
          "50%": { "background-position": "100% 50%" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
        glow: {
          "0%": { "box-shadow": "0 0 20px rgba(239, 19, 19, 0.3), 0 0 40px rgba(239, 19, 19, 0.1)" },
          "100%": { "box-shadow": "0 0 40px rgba(239, 19, 19, 0.6), 0 0 80px rgba(239, 19, 19, 0.3)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        marquee: {
          "0%": { transform: "translateX(0%)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      backgroundImage: {
        "grid-red": "linear-gradient(rgba(239,19,19,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(239,19,19,0.08) 1px, transparent 1px)",
        "radial-red": "radial-gradient(ellipse at center, rgba(239,19,19,0.15), transparent 70%)",
      },
      boxShadow: {
        "glow-red": "0 0 30px rgba(239, 19, 19, 0.4), 0 0 60px rgba(239, 19, 19, 0.2)",
        "glow-red-lg": "0 0 60px rgba(239, 19, 19, 0.6), 0 0 120px rgba(239, 19, 19, 0.3)",
      },
    },
  },
  plugins: [],
}
