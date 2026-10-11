/**
 * Minimal hash router.
 *   #/games              -> lobby
 *   #/games/<gameId>     -> a game
 *   #/account, #/settings
 */
export function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = parts[0] || 'games';
  return { tab, gameId: tab === 'games' ? parts[1] ?? null : null };
}

export function navigate(path) {
  const target = `#/${path}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

/** @param {(route: ReturnType<typeof parseRoute>) => void} handler */
export function startRouter(handler) {
  const run = () => handler(parseRoute());
  window.addEventListener('hashchange', run);
  run();
}
