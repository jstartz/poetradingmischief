import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        ink: "#171717",
        parchment: "#fafaf7",
        ember: "#c2410c",
        gold: "#b8893b",
        rust: "#7c2d12",
      },
    },
  },
  plugins: [],
} satisfies Config;
