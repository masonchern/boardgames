import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** Short git commit of the code being built (CI sets GITHUB_SHA; locally ask git). */
function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Display version = major.minor from package.json + the number of commits as the patch,
 * so it goes up automatically with every change (e.g. 0.1.42). Bump major/minor by hand
 * in package.json only for big milestones.
 */
function version() {
  const [major, minor, patch] = pkg.version.split('.');
  try {
    const count = execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${major}.${minor}.${count}`;
  } catch {
    return `${major}.${minor}.${patch}`;
  }
}

/**
 * Writes dist/version.json ({ commit, version }). Open pages fetch it (never cached) and offer an
 * update when it differs from the build they are running (see src/core/updateCheck.js).
 */
function versionFile() {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ commit: commit(), version: version() }),
      });
    },
  };
}

// `npm run build` -> static site in dist/ (this is what CI deploys to GitHub Pages).
export default defineConfig(({ command }) => ({
  plugins: [versionFile()],
  // Relative asset paths so the site works at a domain root (example.com/)
  // or under a sub-path (user.github.io/boardgames/).
  base: './',
  server: { port: 5173, open: true },
  // Stamped into the bundle; shown in the page footer (see src/core/buildInfo.js).
  define: {
    __APP_VERSION__: JSON.stringify(version()),
    __BUILD_COMMIT__: JSON.stringify(commit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_KIND__: JSON.stringify(command === 'serve' ? 'dev' : 'live'),
    __API_URL__: JSON.stringify(process.env.VITE_API_URL || 'http://localhost:8787'),
  },
}));
