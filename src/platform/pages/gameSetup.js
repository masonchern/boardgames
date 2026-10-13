import { el } from '../../core/dom.js';

/**
 * Generic pre-game setup screen, built from `manifest.options`.
 * Any game that declares options gets this screen for free.
 *
 * Option types:
 * - `number`: a number input. With `unlimited: true` it also gets a "No limit" checkbox,
 *   and ticking it yields `null`.
 * - `select`: pick one of `choices` (large option buttons). Yields the chosen `value`.
 *
 * @param {import('../../core/types.js').GameManifest} manifest
 * @param {{ onLocal: Function, onOnline?: Function } | Function} handlers
 *     A function is treated as onLocal (older call sites). Pass `{ onLocal, onOnline }`
 *     to offer both pass-and-play and a hosted online room.
 */
export function renderGameSetup(manifest, handlers) {
  const onLocal = typeof handlers === 'function' ? handlers : handlers.onLocal;
  const onOnline = typeof handlers === 'function' ? null : handlers.onOnline;
  const readers = new Map(); // option id -> () => value

  const rows = (manifest.options ?? []).map((def) => (def.type === 'select' ? selectRow(def, readers) : numberRow(def, readers)));

  function readValues() {
    return Object.fromEntries([...readers].map(([id, read]) => [id, read()]));
  }

  return el(
    'form',
    {
      class: 'setup',
      onsubmit: (e) => {
        e.preventDefault();
        onLocal(readValues());
      },
    },
    el('div', { class: 'setup__icon' }, manifest.icon ?? '🎲'),
    el('h2', {}, `${manifest.title}: game setup`),
    el('p', { class: 'muted' }, 'Choose your settings, then start. Defaults are a good place to begin.'),
    el('div', { class: 'setup__fields' }, rows),
    el(
      'div',
      { class: 'row-actions' },
      el('button', { class: 'btn', type: 'submit' }, 'Play on this device'),
      onOnline &&
        el(
          'button',
          {
            class: 'btn btn--ghost',
            type: 'button',
            onclick: () => onOnline(readValues()),
          },
          'Play online',
        ),
    ),
  );
}

function numberRow(def, readers) {
  const input = el('input', {
    type: 'number',
    min: def.min,
    max: def.max,
    step: def.step ?? 1,
    value: def.default,
    required: true,
  });

  let noLimit = null;
  let unlimitedLabel = null;
  if (def.unlimited) {
    noLimit = el('input', {
      type: 'checkbox',
      onchange: () => {
        input.disabled = noLimit.checked;
        input.required = !noLimit.checked;
      },
    });
    unlimitedLabel = el('label', { class: 'field__nolimit' }, noLimit, 'No limit');
  }

  readers.set(def.id, () => {
    if (noLimit?.checked) return null;
    let v = Number(input.value);
    if (!Number.isFinite(v)) v = def.default;
    return Math.min(def.max ?? v, Math.max(def.min ?? v, v));
  });

  return el(
    'div',
    { class: 'field' },
    el(
      'div',
      { class: 'field__text' },
      el('span', { class: 'field__label' }, def.label),
      def.description && el('span', { class: 'muted' }, def.description),
    ),
    el('div', { class: 'field__input' }, input, def.unit && el('span', { class: 'muted' }, def.unit), unlimitedLabel),
  );
}

/** A group of big radio-style buttons, one per choice. */
function selectRow(def, readers) {
  let value = def.default;
  const buttons = def.choices.map((choice) => {
    const btn = el(
      'button',
      {
        type: 'button',
        class: 'choice',
        'aria-pressed': 'false',
        onclick: () => {
          value = choice.value;
          sync();
        },
      },
      el('span', { class: 'choice__label' }, choice.label),
      choice.description && el('span', { class: 'choice__desc' }, choice.description),
    );
    return { choice, btn };
  });

  function sync() {
    for (const { choice, btn } of buttons) {
      const selected = choice.value === value;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    }
  }
  sync();

  readers.set(def.id, () => value);

  return el(
    'div',
    { class: 'field field--choices' },
    el(
      'div',
      { class: 'field__text' },
      el('span', { class: 'field__label' }, def.label),
      def.description && el('span', { class: 'muted' }, def.description),
    ),
    el('div', { class: 'choices' }, buttons.map((b) => b.btn)),
  );
}
