import { GameSession } from './session.js';
import { getManifest, loadGameModule } from './registry.js';
import { WebSocketTransport } from './transport.js';
import { t } from './i18n.js';

/** Default players for local pass-and-play. */
function defaultLocalPlayers(count) {
  const colors = ['#6c8cff', '#ff6b9a', '#4fd1a5', '#ffb84d'];
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: t('playerN', { n: i + 1 }),
    color: colors[i % colors.length],
  }));
}

/**
 * Game Loader: resolves a game id into a running, mounted game.
 * It knows nothing about any specific game; it only speaks the plugin contract.
 *
 * @param {string} gameId
 * @param {HTMLElement} container
 * @param {{
 *   exit: () => void,
 *   options?: Object,
 *   mode?: 'local'|'online',
 *   localPlayerId?: string|null,
 *   players?: import('./types.js').Player[],
 *   transport?: {connect:Function,send:Function,close:Function}|null,
 * }} hooks
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function mountGame(gameId, container, hooks) {
  const manifest = getManifest(gameId);
  if (!manifest) throw new Error(`Unknown game: ${gameId}`);
  if (manifest.status !== 'playable') throw new Error(`Game not playable yet: ${gameId}`);

  const game = await loadGameModule(gameId);
  const mode = hooks.mode ?? 'local';
  const players = hooks.players ?? defaultLocalPlayers(manifest.players.min);

  const session = new GameSession({
    rules: game.rules,
    players,
    mode,
    localPlayerId: hooks.localPlayerId ?? null,
    options: hooks.options ?? {},
    transport: hooks.transport ?? undefined,
  });

  let view = null;
  const api = {
    players,
    mode: session.mode,
    localPlayerId: session.localPlayerId,
    getState: () => session.getState(),
    dispatch: (action, playerId) => session.dispatch(action, playerId),
    exit: hooks.exit,
  };

  // The first state arrives asynchronously, so mount the view once it is ready.
  const unsubscribe = session.subscribe((state) => {
    if (!view) view = game.mount(container, api);
    view.update(state);
  });
  session.onError((err) => console.warn('[session] rejected action:', err.message));
  session.start();

  return {
    destroy() {
      unsubscribe();
      view?.destroy();
      session.destroy();
      container.replaceChildren();
    },
  };
}

export { WebSocketTransport };
