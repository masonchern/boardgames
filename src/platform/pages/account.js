import { el } from '../../core/dom.js';

/** Placeholder. Real login / registration will be plugged in here later. */
export function renderAccount() {
  return el(
    'section',
    { class: 'page' },
    el('header', { class: 'page__header' }, el('h1', {}, 'Account'), el('p', {}, 'Profile and sign-in.')),
    el(
      'div',
      { class: 'panel' },
      el(
        'div',
        { class: 'profile' },
        el('div', { class: 'avatar' }, 'G'),
        el(
          'div',
          {},
          el('h3', {}, 'Guest'),
          el('p', { class: 'muted' }, 'Sign-in / registration is under development. You are in guest mode.'),
        ),
      ),
      el(
        'div',
        { class: 'row-actions' },
        el('button', { class: 'btn', disabled: true }, 'Sign in'),
        el('button', { class: 'btn btn--ghost', disabled: true }, 'Create account'),
      ),
    ),
  );
}
