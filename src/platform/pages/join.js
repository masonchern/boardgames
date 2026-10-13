import { el } from '../../core/dom.js';
import { ensureSession } from '../../core/auth.js';
import { navigate } from '../../core/router.js';
import { api } from '../../core/api.js';

/** Join by code from the URL or a form. */
export function renderJoinPage(codeFromUrl) {
  const input = el('input', {
    type: 'text',
    class: 'room-input',
    maxlength: 6,
    placeholder: 'ABC123',
    value: (codeFromUrl || '').toUpperCase(),
    autocapitalize: 'characters',
  });
  const err = el('p', { class: 'account__msg is-error' });
  err.hidden = true;

  async function go(code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 6) {
      err.textContent = 'Room codes are 6 characters.';
      err.hidden = false;
      return;
    }
    try {
      await ensureSession();
      await api(`/api/rooms/${c}/join`, { method: 'POST' });
      navigate(`room/${c}`);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  }

  if (codeFromUrl && codeFromUrl.length === 6) {
    go(codeFromUrl);
  }

  return el(
    'section',
    { class: 'page' },
    el('header', { class: 'page__header' }, el('h1', {}, 'Join a room'), el('p', {}, 'Enter a room code from a friend.')),
    el(
      'div',
      { class: 'panel' },
      err,
      el(
        'form',
        {
          class: 'account__form',
          onsubmit: (e) => {
            e.preventDefault();
            go(input.value);
          },
        },
        input,
        el('button', { class: 'btn', type: 'submit' }, 'Join'),
      ),
    ),
  );
}
