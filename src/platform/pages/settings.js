import { el } from '../../core/dom.js';
import { t } from '../../core/i18n.js';

/** Placeholder rows. Wire them to a real settings store later. */
function rows() {
  return [
    [t('settings.sound'), t('settings.sound.desc')],
    [t('settings.music'), t('settings.music.desc')],
    [t('settings.theme'), t('settings.theme.desc')],
  ];
}

export function renderSettings() {
  return el(
    'section',
    { class: 'page' },
    el(
      'header',
      { class: 'page__header' },
      el('h1', {}, t('settings.title')),
      el('p', {}, t('settings.blurb')),
    ),
    el(
      'div',
      { class: 'panel' },
      rows().map(([title, desc]) =>
        el(
          'div',
          { class: 'setting-row' },
          el('div', {}, el('h3', {}, title), el('p', { class: 'muted' }, desc)),
          el('span', { class: 'chip chip--coming-soon' }, t('settings.soon')),
        ),
      ),
    ),
  );
}
