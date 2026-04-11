/** @type {import('tailwindcss').Config} */
// Precision Obsidian design system — exported from Stitch.
// Material Design 3 tonal palette tuned for a dark, high-density GIS tool.
// Do NOT use 1px solid borders for primary sectioning — use background shifts.
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces (tonal layering)
        background:                  '#111319',
        surface:                     '#111319',
        'surface-dim':               '#111319',
        'surface-bright':            '#373940',
        'surface-container-lowest':  '#0c0e14',
        'surface-container-low':     '#191b22',
        'surface-container':         '#1e1f26',
        'surface-container-high':    '#282a30',
        'surface-container-highest': '#33343b',
        'surface-variant':           '#33343b',
        'surface-tint':              '#ddb7ff',

        // Text on surfaces
        'on-background':       '#e2e2eb',
        'on-surface':          '#e2e2eb',
        'on-surface-variant':  '#cfc2d6',
        'inverse-surface':     '#e2e2eb',
        'inverse-on-surface':  '#2e3037',

        // Primary (purple — surgical accent only)
        primary:                    '#ddb7ff',
        'primary-container':        '#b76dff',
        'primary-fixed':            '#f0dbff',
        'primary-fixed-dim':        '#ddb7ff',
        'on-primary':               '#490080',
        'on-primary-container':     '#400071',
        'on-primary-fixed':         '#2c0051',
        'on-primary-fixed-variant': '#6900b3',
        'inverse-primary':          '#842bd2',

        // Secondary (blue accent)
        secondary:                  '#adc6ff',
        'secondary-container':      '#0566d9',
        'secondary-fixed':          '#d8e2ff',
        'secondary-fixed-dim':      '#adc6ff',
        'on-secondary':             '#002e6a',
        'on-secondary-container':   '#e6ecff',
        'on-secondary-fixed':       '#001a42',
        'on-secondary-fixed-variant': '#004395',

        // Tertiary (green — success / "active" states)
        tertiary:                   '#4ae176',
        'tertiary-container':       '#00a74b',
        'tertiary-fixed':           '#6bff8f',
        'tertiary-fixed-dim':       '#4ae176',
        'on-tertiary':              '#003915',
        'on-tertiary-container':    '#003111',
        'on-tertiary-fixed':        '#002109',
        'on-tertiary-fixed-variant':'#005321',

        // Error / warning
        error:               '#ffb4ab',
        'error-container':   '#93000a',
        'on-error':          '#690005',
        'on-error-container':'#ffdad6',

        // Outline (used as ghost borders only)
        outline:         '#988d9f',
        'outline-variant':'#4d4354',

        // Detection bbox colours (for chips and bbox overlays)
        'bbox-purple':     '#c084fc',
        'bbox-yellow':     '#facc15',
        'bbox-orange':     '#fb923c',
        'bbox-chartreuse': '#a3e635',
        'bbox-white':      '#f5f5f4',
        'bbox-red':        '#ef4444',
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg:      '0.25rem',
        xl:      '0.5rem',
        full:    '9999px',
      },
      fontFamily: {
        sans:     ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        headline: ['Inter', 'sans-serif'],
        body:     ['Inter', 'sans-serif'],
        label:    ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
