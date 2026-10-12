// PROJECT E.V. — PostCSS config (canonical Tailwind v4 setup per Next docs).
// Replaces the scaffold's experimental `@tailwindcss/turbopack` loader rule,
// which left `@theme` unprocessed (no preflight, no theme utilities).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
