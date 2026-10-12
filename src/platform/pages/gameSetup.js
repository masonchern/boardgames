import { el } from '../../core/dom.js';

/**
 * Generic pre-game setup screen, built from `manifest.options`.
 * Any game that declares options gets this screen for free.
 *
 * @param {import('../../core/types.js').GameManifest} manifest
 * @param {(values: Record<string, number>) => void} onStart
 */
export function renderGameSetup(manifest, onStart) {
  const inputs = new Map();

  const rows = manifest.options.map((def) => {
    const input = el('input', {
      type: 'number',
      min: def.min,
      max: def.max,
      step: def.step ?? 1,
      value: def.default,
      required: true,
    });
    inputs.set(def.id, { input, def });
    return el(
      'label',
      { class: 'field' },
      el(
        'div',
        { class: 'field__text' },
        el('span', { class: 'field__label' }, def.label),
        def.description && el('span', { class: 'muted' }, def.description),
      ),
      el('div', { class: 'field__input' }, input, def.unit && el('span', { class: 'muted' }, def.unit)),
    );
  });

  function readValues() {
    const values = {};
    for (const [id, { input, def }] of inputs) {
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
