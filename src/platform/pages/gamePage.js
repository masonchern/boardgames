import { el } from '../../core/dom.js';
import { navigate } from '../../core/router.js';
import { getManifest } from '../../games/registry.js';
import { mountGame } from '../../core/gameLoader.js';
import { renderGameSetup } from './gameSetup.js';

/**
 * Hosts a game. Returns { node, destroy } so the shell can clean up on navigation.
 * If the manifest declares `options`, a setup screen is shown before the game starts.
 */
export function renderGamePage(gameId) {
  const manifest = getManifest(gameId);
  const exit = () => navigate('games');

  const stage = el('div', { class: 'game-stage' });
  const wide = manifest?.layout === 'wide';
  const node = el(
    'section',
    { class: `page page--game ${wide ? 'page--wide' : ''}` },
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

  function launch(options) {
    // The game gets its own root so the loading placeholder never clobbers the view
    // (the view mounts as soon as the first state arrives, possibly before our .then runs).
    const loading = placeholder('⏳', 'Loading…', '');
    const gameRoot = el('div', { class: 'game-root' });
    stage.replaceChildren(loading, gameRoot);

    mountGame(gameId, gameRoot, { exit, options })
      .then((h) => {
        loading.remove();
        if (destroyed) h.destroy();
        else handle = h;
      })
      .catch((err) => {
        console.error(err);
        stage.replaceChildren(placeholder('⚠️', 'Failed to load game', String(err.message)));
      });
  }

  if (manifest.options?.length) stage.append(renderGameSetup(manifest, launch));
  else launch({});

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
