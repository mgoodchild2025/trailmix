import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Production builds load from file://, so add a strict CSP there. The dev server is
// left without one because React's fast-refresh preamble is an inline script.
const CSP = [
  "default-src 'self' file:",
  "script-src 'self' file: blob:",
  "style-src 'self' file: 'unsafe-inline'",
  "font-src 'self' file: data:",
  "img-src 'self' file: data:",
  "connect-src 'none'",
].join('; ');

const csp = {
  name: 'trailmix-csp',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      if (ctx.server) return html;
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), csp],
  build: { outDir: 'dist', emptyOutDir: true },
});
