/**
 * Tic-Tac-Toe rules: pure functions, no DOM.
 * These can run unchanged on a future authoritative server.
 *
 * State:   { board: (string|null)[9], players: Player[], turn: 0|1, winnerId, line, isDraw }
 * Actions: { type: 'PLACE', index: 0..8 } | { type: 'RESET' }
 */

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** @type {import('../../core/types.js').GameRules} */
export const rules = {
  setup({ players }) {
    return {
      players: players.slice(0, 2).map((p) => ({ id: p.id, name: p.name })),
      board: Array(9).fill(null), // each cell holds a player id or null
      turn: 0,
      winnerId: null,
      line: null,
      isDraw: false,
    };
  },

  validate(state, action, playerId) {
    if (action.type === 'RESET') return { ok: true };
    if (action.type !== 'PLACE') return { ok: false, error: 'Unknown action' };
    if (state.winnerId || state.isDraw) return { ok: false, error: 'Game is over' };
    if (state.players[state.turn].id !== playerId) return { ok: false, error: 'Not your turn' };
    if (!Number.isInteger(action.index) || action.index < 0 || action.index > 8) {
      return { ok: false, error: 'Invalid cell' };
    }
    if (state.board[action.index] !== null) return { ok: false, error: 'Cell already taken' };
    return { ok: true };
  },

  reduce(state, action, playerId) {
    if (action.type === 'RESET') {
      // Loser (or the player after the last mover) starts the next round.
      const next = rules.setup({ players: state.players });
      next.turn = 1 - state.turn;
      return next;
    }

    const board = state.board.slice();
    board[action.index] = playerId;

    const line = LINES.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]) ?? null;
    const isDraw = !line && board.every(Boolean);

    return {
      ...state,
      board,
      line,
      isDraw,
      winnerId: line ? playerId : null,
      turn: line || isDraw ? state.turn : 1 - state.turn,
    };
  },

  getStatus(state) {
    const over = Boolean(state.winnerId) || state.isDraw;
    const current = state.players[state.turn];
    let message = `${current.name}'s turn`;
    if (state.winnerId) message = `${state.players.find((p) => p.id === state.winnerId).name} wins!`;
    else if (state.isDraw) message = "It's a draw";
    return {
      isOver: over,
      currentPlayerId: over ? null : current.id,
      winnerId: state.winnerId,
      message,
    };
  },
};
