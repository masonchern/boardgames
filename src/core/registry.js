/**
 * Game registry with automatic discovery (Vite `import.meta.glob`).
 *
 * To add a game, just create a folder under src/games/ containing:
 *   - manifest.js  (lightweight metadata, loaded eagerly for the lobby)
 *   - index.js     (rules + view, loaded lazily only when the game is played)
 * No platform code needs to change.
 */

/** Eagerly load every manifest (small, needed to render lobby cards). */
const manifestModules = import.meta.glob('../games/*/manifest.js', { eager: true, import: 'default' });

/** Lazy loaders for the heavy game modules. Each becomes its own code-split chunk. */
const gameLoaders = import.meta.glob('../games/*/index.js', { import: 'default' });

/** @type {import('./types.js').GameManifest[]} */
export const manifests = Object.values(manifestModules).sort(
  // Lower `order` first; games without one go last (then alphabetical by title).
  (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title),
);

export function getManifest(id) {
  return manifests.find((m) => m.id === id) ?? null;
}

/**
 * Lazily load the game implementation (rules + view).
 * @param {string} id
 * @returns {Promise<import('./types.js').GameModule>}
 */
export async function loadGameModule(id) {
  const loader = gameLoaders[`../games/${id}/index.js`];
  if (!loader) throw new Error(`Unknown game: ${id}`);
  return loader();
}
