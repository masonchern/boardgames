import './styles.css';
import { el } from '../../core/dom.js';
import { rules } from './rules.js';

/**
 * Tic-Tac-Toe view. It only renders state and dispatches actions;
 * it never changes the state itself.
 *
 * @type {import('../../core/types.js').GameModule['mount']}
 */
export function mount(container, api) {
  const symbols = { [api.players[0].id]: 'X', [api.players[1].id]: 'O' };

  const statusEl = el('div', { class: 'ttt__status' });
  const boardEl = el('div', { class: 'ttt__board' });
  const cells = Array.from({ length: 9 }, (_, index) => {
    const cell = el('button', {
      class: 'ttt__cell',
      'aria-label': `Cell ${index + 1}`,
      onclick: () => api.dispatch({ type: 'PLACE', index }),
    });
    boardEl.append(cell);
    return cell;
  });

  const scoreEls = api.players.map((p) =>
    el('div', { class: 'ttt__player' }, el('span', { class: 'ttt__sym' }, symbols[p.id]), el('span', {}, p.name)),
  );

  const resetBtn = el(
    'button',
    { class: 'btn', onclick: () => api.dispatch({ type: 'RESET' }) },
    'Play again',
  );
  const exitBtn = el('button', { class: 'btn btn--ghost', onclick: api.exit }, 'Back to lobby');

  const root = el(
    'div',
    { class: 'ttt' },
    el('div', { class: 'ttt__players' }, scoreEls),
    statusEl,
    boardEl,
    el('div', { class: 'row-actions' }, resetBtn, exitBtn),
  );
  container.append(root);

  return {
    update(state) {
      const status = rules.getStatus(state);
      statusEl.textContent = status.message;
      statusEl.classList.toggle('is-over', status.isOver);

      state.board.forEach((owner, i) => {
        const cell = cells[i];
        cell.textContent = owner ? symbols[owner] : '';
        cell.dataset.symbol = owner ? symbols[owner] : '';
        cell.disabled = Boolean(owner) || status.isOver;
        cell.classList.toggle('is-win', Boolean(state.line?.includes(i)));
      });

      scoreEls.forEach((node, i) =>
        node.classList.toggle('is-active', api.players[i].id === status.currentPlayerId),
      );
      resetBtn.hidden = !status.isOver;
    },
    destroy() {
      root.remove();
    },
  };
}
