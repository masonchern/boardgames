import { el } from '../../core/dom.js';
import { navigate } from '../../core/router.js';
import { manifests } from '../../core/registry.js';
import { t, gameText } from '../../core/i18n.js';

function gameCard(manifest) {
  const playable = manifest.status === 'playable';
  const players =
    manifest.players.min === manifest.players.max
      ? t('players.count', { n: manifest.players.min })
      : t('players.range', { min: manifest.players.min, max: manifest.players.max });
  return el(
    'button',
    {
      class: `game-card ${playable ? '' : 'is-locked'}`,
      style: { '--accent': manifest.accent ?? '#6c8cff' },
      onclick: () => navigate(`games/${manifest.id}`),
    },
    el('div', { class: 'game-card__icon' }, manifest.icon ?? '🎲'),
    el(
      'div',
      { class: 'game-card__body' },
      el('h3', {}, gameText(manifest.id, 'title', manifest.title)),
      manifest.subtitle &&
        el('p', { class: 'game-card__subtitle' }, gameText(manifest.id, 'subtitle', manifest.subtitle)),
      el('p', { class: 'game-card__desc' }, gameText(manifest.id, 'description', manifest.description)),
    ),
    el(
      'div',
      { class: 'game-card__footer' },
      el('span', { class: 'chip' }, players),
      el('span', { class: `chip chip--${manifest.status}` }, t(`status.${manifest.status}`)),
    ),
  );
}

export function renderLobby() {
  return el(
    'section',
    { class: 'page' },
    el(
      'header',
      { class: 'page__header' },
      el('h1', {}, t('lobby.title')),
      el('p', {}, t('lobby.blurb')),
      el('button', { class: 'btn btn--ghost', onclick: () => navigate('join') }, t('lobby.join')),
    ),
    el('div', { class: 'card-grid' }, manifests.map(gameCard)),
  );
}
