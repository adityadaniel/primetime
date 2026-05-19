import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bone: "#F2EBDC",
        ink: "#0F0F0F",
        vermilion: "#E5341F",
        marigold: "#F2A900",
        cobalt: "#1B3A6B",
        ivy: "#1F4D3A",
        ash: "#B7B0A1",
      },
      fontFamily: {
        display: ['"Big Shoulders Display"', "ui-sans-serif", "system-ui"],
        editorial: ['"Newsreader"', "ui-serif", "Georgia"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Menlo"],
      },
      letterSpacing: {
        broadcast: "0.08em",
      },
    },
  },
  plugins: [],
} satisfies Config;
