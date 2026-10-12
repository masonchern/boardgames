/* global __APP_VERSION__, __BUILD_COMMIT__, __BUILD_TIME__, __BUILD_KIND__ */

/**
 * Build stamp injected by Vite (see `define` in vite.config.js).
 * Lets anyone compare the version they see on a device with the latest commit on GitHub.
 */
export const buildInfo = {
  version: __APP_VERSION__,
  commit: __BUILD_COMMIT__,
  time: __BUILD_TIME__,
  kind: __BUILD_KIND__,
};

/** e.g. "v0.1.0 · build d32907f · 2026-10-12 02:41 UTC" (dev servers say "dev build"). */
export function buildLabel() {
  const when = buildInfo.time.slice(0, 16).replace('T', ' ');
  const label = buildInfo.kind === 'dev' ? 'dev build' : 'build';
  return `v${buildInfo.version} · ${label} ${buildInfo.commit} · ${when} UTC`;
}
