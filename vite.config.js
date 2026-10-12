import { defineConfig } from 'vite';

// `npm run build` -> static site in dist/ (this is what CI deploys to GitHub Pages).
export default defineConfig({
  // Relative asset paths so the site works at a domain root (example.com/)
  // or under a sub-path (user.github.io/boardgames/).
  base: './',
  server: { port: 5173, open: true },
});
