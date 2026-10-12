import { el } from '../../core/dom.js';

/**
 * Generic pre-game setup screen, built from `manifest.options`.
 * Any game that declares options gets this screen for free.
 *
 * Options with `unlimited: true` also get a "No limit" checkbox; ticking it yields `null`.
 *
 * @param {import('../../core/types.js').GameManifest} manifest
 * @param {(values: Record<string, number|null>) => void} onStart
 */
export function renderGameSetup(manifest, onStart) {
  const fields = new Map();

  const rows = manifest.options.map((def) => {
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

    fields.set(def.id, { input, noLimit, def });
    return el(
      'div',
      { class: 'field' },
      el(
        'div',
        { class: 'field__text' },
        el('span', { class: 'field__label' }, def.label),
        def.description && el('span', { class: 'muted' }, def.description),
      ),
      el(
        'div',
        { class: 'field__input' },
        input,
        def.unit && el('span', { class: 'muted' }, def.unit),
        unlimitedLabel,
      ),
    );
  });

  function readValues() {
    const values = {};
    for (const [id, { input, noLimit, def }] of fields) {
      if (noLimit?.checked) {
        values[id] = null;
        continue;
      }
      let v = Number(input.value);
      if (!Number.isFinite(v)) v = def.default;
      values[id] = Math.min(def.max ?? v, Math.max(def.min ?? v, v));
    }
    return values;
  }

  return el(
    'form',
    {
      class: 'setup',
      onsubmit: (e) => {
        e.preventDefault();
        onStart(readValues());
      },
    },
    el('div', { class: 'setup__icon' }, manifest.icon ?? '🎲'),
    el('h2', {}, `${manifest.title}: game setup`),
    el('p', { class: 'muted' }, 'Choose your settings, then start. Defaults are a good place to begin.'),
    el('div', { class: 'setup__fields' }, rows),
    el('button', { class: 'btn', type: 'submit' }, 'Start game'),
  );
}
