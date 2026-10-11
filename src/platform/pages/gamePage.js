import { el } from '../../core/dom.js';
import { navigate } from '../../core/router.js';
import { getManifest } from '../../games/registry.js';
import { mountGame } from '../../core/gameLoader.js';

/**
 * Hosts a game. Returns { node, destroy } so the shell can clean up on navigation.
 */
export function renderGamePage(gameId) {
  const manifest = getManifest(gameId);
  const exit = () => navigate('games');

  const stage = el('div', { class: 'game-stage' });
  const node = el(
    'section',
    { class: 'page page--game' },
    el(
      'header',
      { class: 'game-bar' },
      el('button', { class: 'btn btn--ghost', onclick: exit }, '← Back to lobby'),
      el('div', { class: 'game-bar__title' }, manifest?.title ?? 'Unknown game'),
      el('div', { class: 'game-bar__spacer' }),
    ),
    stage,
  );

  if (!manifest) {
    stage.append(placeholder('🧭', 'Game not found', 'This game does not exist.'));
    return { node, destroy() {} };
  }
  if (manifest.status !== 'playable') {
    stage.append(
      placeholder(
        manifest.icon ?? '🚧',
        manifest.title,
        'Game under development. Coming soon!',
      ),
    );
    return { node, destroy() {} };
  }

  let handle = null;
  let destroyed = false;

  // The game gets its own root so the loading placeholder never clobbers the view
  // (the view mounts as soon as the first state arrives, possibly before our .then runs).
  const loading = placeholder('⏳', 'Loading…', '');
  const gameRoot = el('div', { class: 'game-root' });
  stage.append(loading, gameRoot);

  mountGame(gameId, gameRoot, { exit })
    .then((h) => {
      loading.remove();
      if (destroyed) h.destroy();
      else handle = h;
    })
    .catch((err) => {
      console.error(err);
      stage.replaceChildren(placeholder('⚠️', 'Failed to load game', String(err.message)));
    });

  return {
    node,
    destroy() {
      destroyed = true;
      handle?.destroy();
    },
  };
}

function placeholder(icon, title, text) {
  return el(
    'div',
    { class: 'empty' },
    el('div', { class: 'empty__icon' }, icon),
    el('h2', {}, title),
    text && el('p', {}, text),
  );
}
