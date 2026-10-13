/**
 * Minimal hash router.
 *   #/games              -> lobby
 *   #/games/<gameId>     -> a game (setup / local play)
 *   #/join/<CODE>        -> join an online room
 *   #/room/<CODE>        -> waiting room / live match
 *   #/account, #/settings
 */
export function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = parts[0] || 'games';
  if (tab === 'join') return { tab: 'join', joinCode: (parts[1] || '').toUpperCase(), gameId: null, roomCode: null };
  if (tab === 'room') return { tab: 'room', roomCode: (parts[1] || '').toUpperCase(), gameId: null, joinCode: null };
  return {
    tab,
    gameId: tab === 'games' ? parts[1] ?? null : null,
    joinCode: null,
    roomCode: null,
  };
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
