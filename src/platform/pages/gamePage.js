import { el } from '../../core/dom.js';
import { navigate } from '../../core/router.js';
import { getManifest } from '../../core/registry.js';
import { mountGame } from '../../core/gameLoader.js';
import { renderGameSetup } from './gameSetup.js';
import { api } from '../../core/api.js';
import { ensureSession } from '../../core/auth.js';
import { t, te, gameText, onLang } from '../../core/i18n.js';

/**
 * Hosts a game. Returns { node, destroy } so the shell can clean up on navigation.
 * If the manifest declares `options`, a setup screen is shown before the game starts.
 */
export function renderGamePage(gameId) {
  const manifest = getManifest(gameId);
  const exit = () => navigate('games');
  const titleText = () => gameText(gameId, 'title', manifest?.title ?? t('game.unknown'));

  const stage = el('div', { class: 'game-stage' });
  const backBtn = el('button', { class: 'btn btn--ghost', onclick: exit }, t('back.lobby'));
  const titleEl = el('div', { class: 'game-bar__title' }, titleText());
  const wide = manifest?.layout === 'wide';
  const node = el(
    'section',
    { class: `page page--game ${wide ? 'page--wide' : ''}` },
    el('header', { class: 'game-bar' }, backBtn, titleEl, el('div', { class: 'game-bar__spacer' })),
    stage,
  );

  if (!manifest) {
    stage.append(placeholder('🧭', t('game.notFound'), t('game.notFound.blurb')));
    return { node, destroy() {} };
  }
  if (manifest.status !== 'playable') {
    stage.append(placeholder(manifest.icon ?? '🚧', titleText(), t('game.wip.blurb')));
    return { node, destroy() {} };
  }

  let handle = null;
  let destroyed = false;
  let started = false;

  function launch(options) {
    started = true;
    // The game gets its own root so the loading placeholder never clobbers the view
    // (the view mounts as soon as the first state arrives, possibly before our .then runs).
    const loading = placeholder('⏳', t('game.loading'), '');
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
        stage.replaceChildren(placeholder('⚠️', t('game.loadFail'), String(err.message)));
      });
  }

  async function openOnline(options) {
    started = true;
    try {
      await ensureSession();
      const data = await api('/api/rooms', { method: 'POST', body: { gameId, options } });
      navigate(`room/${data.room.code}`);
    } catch (err) {
      stage.replaceChildren(placeholder('⚠️', t('game.roomFail'), te(err.message)));
    }
  }

  function showSetup() {
    if (manifest.options?.length) {
      stage.replaceChildren(renderGameSetup(manifest, { onLocal: launch, onOnline: openOnline }));
    } else {
      stage.replaceChildren(
        renderGameSetup({ ...manifest, options: [] }, { onLocal: () => launch({}), onOnline: () => openOnline({}) }),
      );
    }
  }

  showSetup();

  const stopLang = onLang(() => {
    backBtn.textContent = t('back.lobby');
    titleEl.textContent = titleText();
    if (!started && !destroyed) showSetup();
  });

  return {
    node,
    destroy() {
      destroyed = true;
      stopLang();
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
