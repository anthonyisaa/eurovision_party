import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Vienna 2026 palette. Token names kept from the previous theme so
        // existing usages still resolve; the colors are remapped to match
        // Eurovision's 70th-anniversary identity:
        //   eurorose  → the Eurovision/Austrian flag red (heart color)
        //   eurogold  → warm Viennese-secession cream/gold (accent flourishes)
        //   europurp  → deep ink near-black (dark surfaces, gradient base)
        eurorose: {
          50:  '#FFF1F2',
          100: '#FFE4E6',
          200: '#FECDD3',
          300: '#FDA4AF',
          400: '#F87171',
          500: '#ED2939', // primary Eurovision red
          600: '#D1202F',
          700: '#A81824',
          800: '#7F121B',
          900: '#560C12',
          950: '#2C0609',
        },
        eurogold: {
          50:  '#FAF6EC',
          100: '#F3EBD3',
          200: '#E9D9A8',
          300: '#DFC57E',
          400: '#D4B05A',
          500: '#C99845',
          600: '#A87B36',
          700: '#825E29',
          800: '#5C421D',
          900: '#3C2B13',
          950: '#1E160A',
        },
        europurp: {
          50:  '#E8E8EE',
          100: '#C9C8D2',
          200: '#A6A5B4',
          300: '#7F7E91',
          400: '#5C5B6D',
          500: '#3E3D4E',
          600: '#2B2A38',
          700: '#1F1E29',
          800: '#15141C',
          900: '#0E0D14',
          950: '#07070B',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
