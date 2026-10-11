import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> normal static site in dist/ (deploy this folder to any web host)
// `npm run build:single` -> one self-contained HTML file (offline / double-click use)
export default defineConfig(({ mode }) => ({
  // Relative asset paths so the site works at a domain root (example.com/)
  // or under a sub-path (user.github.io/boardgames/).
  base: './',
  server: { port: 5173, open: true },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
