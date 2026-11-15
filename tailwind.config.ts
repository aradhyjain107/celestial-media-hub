import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        foreground: "var(--text-main)",
        'sys-bg': "#050505",
        'sys-border': "#2a2a2a",
        'sys-accent': "#FF5A00",
        'sys-accent-hover': "#FF7B33",
        'sys-muted': "#888888",
        'sys-dark': "#444444",
        'bg-void': "var(--bg-void)",
        'bg-surface-1': "var(--bg-surface-1)",
        'bg-surface-2': "var(--bg-surface-2)",
        'bg-surface-3': "var(--bg-surface-3)",
        'accent-primary': "var(--accent-primary)",
        'accent-hover': "var(--accent-hover)",
        'accent-glow': "var(--accent-glow)",
        'accent-subtle': "var(--accent-subtle)",
        'border-subtle': "var(--border-subtle)",
        'border-stark': "var(--border-stark)",
        'border-active': "var(--border-active)",
        'border-specular': "var(--border-specular)",
      },
      boxShadow: {
        'glow-accent': "0 0 20px rgba(255, 90, 0, 0.25)",
        'glow-accent-lg': "0 0 30px rgba(255, 90, 0, 0.4)",
        'glow-sm': "0 0 10px rgba(255, 90, 0, 0.2)",
      },
      backdropBlur: {
        xs: "4px",
        'glass': "16px",
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(255, 90, 0, 0.2)' },
          '50%': { boxShadow: '0 0 25px rgba(255, 90, 0, 0.5)' },
        },
      },
      animation: {
        'pulse-glow': 'pulseGlow 2.5s infinite ease-in-out',
      },
    },
  },
  plugins: [],
};
export default config;
