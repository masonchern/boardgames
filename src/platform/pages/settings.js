import { el } from '../../core/dom.js';

/** Placeholder rows. Wire them to a real settings store later. */
const ROWS = [
  ['Sound effects', 'Play sounds for moves and results'],
  ['Music', 'Background music in the lobby'],
  ['Theme', 'Light (default), dark, and more'],
];

export function renderSettings() {
  return el(
    'section',
    { class: 'page' },
    el(
      'header',
      { class: 'page__header' },
      el('h1', {}, 'Settings'),
      el('p', {}, 'Audio, theme and more. Coming soon.'),
    ),
    el(
      'div',
      { class: 'panel' },
      ROWS.map(([title, desc]) =>
        el(
          'div',
          { class: 'setting-row' },
          el('div', {}, el('h3', {}, title), el('p', { class: 'muted' }, desc)),
          el('span', { class: 'chip chip--coming-soon' }, 'Coming soon'),
        ),
      ),
    ),
  );
}
