import { el } from '../../core/dom.js';
import { navigate } from '../../core/router.js';
import { manifests } from '../../core/registry.js';

const STATUS_LABEL = {
  playable: 'Play now',
  wip: 'In development',
  'coming-soon': 'Coming soon',
};

function gameCard(manifest) {
  const playable = manifest.status === 'playable';
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
      el('h3', {}, manifest.title),
      manifest.subtitle && el('p', { class: 'game-card__subtitle' }, manifest.subtitle),
      el('p', { class: 'game-card__desc' }, manifest.description),
    ),
    el(
      'div',
      { class: 'game-card__footer' },
      el(
        'span',
        { class: 'chip' },
        manifest.players.min === manifest.players.max
          ? `${manifest.players.min} players`
          : `${manifest.players.min}–${manifest.players.max} players`,
      ),
      el('span', { class: `chip chip--${manifest.status}` }, STATUS_LABEL[manifest.status]),
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
      el('h1', {}, 'Games'),
      el('p', {}, 'Pick a game and pass the device around. Online play is coming later.'),
    ),
    el('div', { class: 'card-grid' }, manifests.map(gameCard)),
  );
}
