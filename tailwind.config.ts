import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        govisa: {
          navy: "#1e3a5f",
          red: "#c62828"
        }
      }
    }
  },
  plugins: []
};

export default config;
