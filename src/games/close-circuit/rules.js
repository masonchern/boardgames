/**
 * Close Circuit: authoritative rules (pure functions, no DOM, no Date.now()).
 *
 * RULES IMPLEMENTED (basic mode)
 * - 2 players share one deck of 48 cards. Each card is placed as a straight or a 90-degree turn.
 * - On your turn you place 1 to 3 cards. The very first card of a game goes in the center cell;
 *   every other card must touch (share an edge with) a card already on the board.
 * - After a placement, if every line end on the board connects to another, nothing sticks
 *   out, the circuit is closed and the player who just placed wins.
 * - CHALLENGE ("no solution"): instead of placing, the player whose turn it is may challenge.
 *   The opponent then gets 1-3 cards and (turn time + extra challenge time) to close the circuit.
 *   Closed -> the challenged player wins. Otherwise (fails, concedes, times out) -> challenger wins.
 * - Every turn has a time limit. Running out of time loses the game.
 * - The starter alternates every game, and wins are tracked across games.
 *
 * ASSUMPTIONS (the spec was silent; easy to change here):
 * - Several separate loops count as closed, as long as nothing sticks out.
 * - If the deck runs out without a closed circuit, the game is a draw.
 * - A challenge is only allowed once there is at least one card on the board.
 * - A player may resign (CONCEDE) at any time on their turn.
 *
 * STATE:   see `freshGame` below.
 * ACTIONS: PLAY { placements: [{x,y,kind,rot}] } | CHALLENGE | CONCEDE | TIMEOUT | NEXT_GAME
 */
import { CARD_KINDS, DX, DY, cellKey, isWinningBoard } from './circuit.js';

export const DEFAULT_OPTIONS = {
  turnSeconds: 30, // time per turn (x)
  challengeSeconds: 30, // extra time for a challenged player (y)
  gridSize: 100,
  deckSize: 48,
  maxPerTurn: 3,
};

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export function normalizeOptions(o = {}) {
  const d = DEFAULT_OPTIONS;
  return {
    turnSeconds: clampInt(o.turnSeconds, d.turnSeconds, 5, 600),
    challengeSeconds: clampInt(o.challengeSeconds, d.challengeSeconds, 0, 600),
    gridSize: clampInt(o.gridSize, d.gridSize, 5, 200),
    deckSize: clampInt(o.deckSize, d.deckSize, 1, 200),
    maxPerTurn: clampInt(o.maxPerTurn, d.maxPerTurn, 1, 10),
  };
}

export const centerCell = (gridSize) => Math.floor(gridSize / 2);

/** State for the start of a new game, keeping series info (wins, players, options). */
function freshGame(series, starterIndex, now) {
  const { options } = series;
  return {
    ...series,
    starterIndex,
    board: {}, // "x,y" -> { x, y, kind, rot, owner, turn }
    deckRemaining: options.deckSize,
    turnNumber: 1,
    phase: 'play', // 'play' | 'challenge' | 'over'
    current: starterIndex, // index of the player who must act (the responder during a challenge)
    challengerId: null,
    turnStartedAt: now,
    deadline: now + options.turnSeconds * 1000,
    result: null, // { winnerId: string|null, reason: string } once over
    lastPlaced: [], // keys of the cards placed in the most recent move
  };
}

/**
 * Why `placement` cannot be put on the board right now (given cards `placed` earlier in the
 * same turn), or null if it is legal. The view uses this too, so UI and rules always agree.
 */
export function placementProblem(state, placed, placement) {
  const { x, y, kind, rot } = placement;
  const { gridSize } = state.options;

  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'Invalid cell';
  if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) return 'Outside the grid';
  if (!CARD_KINDS[kind]) return 'Unknown card type';
  if (!Number.isInteger(rot) || rot < 0 || rot >= CARD_KINDS[kind].rotations) return 'Invalid rotation';

  const taken = (cx, cy) => state.board[cellKey(cx, cy)] || placed.find((p) => p.x === cx && p.y === cy);
  if (taken(x, y)) return 'That cell is already occupied';

  const boardIsEmpty = Object.keys(state.board).length === 0 && placed.length === 0;
  if (boardIsEmpty) {
    const c = centerCell(gridSize);
    return x === c && y === c ? null : 'The first card must go in the center cell';
  }

  const touches = [0, 1, 2, 3].some((d) => taken(x + DX[d], y + DY[d]));
  return touches ? null : 'Cards must touch a card that is already on the board';
}

/** Validate a whole turn's placements in order (each card may touch earlier ones of the same turn). */
function placementsProblem(state, placements) {
  if (!Array.isArray(placements)) return 'Missing placements';
  const limit = Math.min(state.options.maxPerTurn, state.deckRemaining);
  if (placements.length < 1) return 'Place at least 1 card';
  if (placements.length > limit) return `You can place at most ${limit} card${limit === 1 ? '' : 's'}`;

  const placed = [];
  for (const p of placements) {
    const problem = placementProblem(state, placed, p);
    if (problem) return problem;
    placed.push(p);
  }
  return null;
}

const isActive = (state) => state.phase === 'play' || state.phase === 'challenge';

/** @type {import('../../core/types.js').GameRules} */
export const rules = {
  setup({ players, options, now = 0 }) {
    const series = {
      options: normalizeOptions(options),
      players: players.slice(0, 2).map((p) => ({ id: p.id, name: p.name })),
      wins: Object.fromEntries(players.slice(0, 2).map((p) => [p.id, 0])),
      draws: 0,
      gameNumber: 1,
    };
    return freshGame(series, 0, now);
  },

  validate(state, action, playerId, meta) {
    const ok = { ok: true };
    const fail = (error) => ({ ok: false, error });

    if (action.type === 'NEXT_GAME') {
      return state.phase === 'over' ? ok : fail('The current game is not finished');
    }
    if (!isActive(state)) return fail('The game is over');

    if (action.type === 'TIMEOUT') {
      // Anyone (or the server's own clock) may report a timeout, but only once it has really expired.
      return meta && meta.now >= state.deadline ? ok : fail('The timer has not expired yet');
    }

    if (state.players[state.current].id !== playerId) return fail('Not your turn');

    switch (action.type) {
      case 'PLAY': {
        const problem = placementsProblem(state, action.placements);
        return problem ? fail(problem) : ok;
      }
      case 'CHALLENGE':
        if (state.phase !== 'play') return fail('You cannot challenge during a challenge');
        if (Object.keys(state.board).length === 0) return fail('Nothing to challenge yet');
        return ok;
      case 'CONCEDE':
        return ok;
      default:
        return fail('Unknown action');
    }
  },

  reduce(state, action, playerId, meta) {
    const now = meta?.now ?? 0;
    const other = 1 - state.current;

    switch (action.type) {
      case 'PLAY': {
        const board = { ...state.board };
        const lastPlaced = [];
        for (const { x, y, kind, rot } of action.placements) {
          const key = cellKey(x, y);
          board[key] = { x, y, kind, rot, owner: playerId, turn: state.turnNumber };
          lastPlaced.push(key);
        }
        const next = {
          ...state,
          board,
          lastPlaced,
          deckRemaining: state.deckRemaining - action.placements.length,
        };
        const closed = isWinningBoard(board, state.options);

        if (state.phase === 'challenge') {
          // The challenged player gets exactly one attempt.
          return closed
            ? finish(next, playerId, 'challenge-success')
            : finish(next, state.challengerId, 'challenge-failed');
        }
        if (closed) return finish(next, playerId, 'closed');
        if (next.deckRemaining === 0) return finish(next, null, 'deck-empty');

        return {
          ...next,
          current: other,
          turnNumber: state.turnNumber + 1,
          turnStartedAt: now,
          deadline: now + state.options.turnSeconds * 1000,
        };
      }

      case 'CHALLENGE': {
        const { turnSeconds, challengeSeconds } = state.options;
        return {
          ...state,
          phase: 'challenge',
          challengerId: playerId,
          current: other, // the challenged player must now close the circuit
          turnNumber: state.turnNumber + 1,
          turnStartedAt: now,
          deadline: now + (turnSeconds + challengeSeconds) * 1000,
        };
      }

      case 'CONCEDE':
        return finish(
          state,
          state.players[other].id,
          state.phase === 'challenge' ? 'challenge-failed' : 'resigned',
        );

      case 'TIMEOUT':
        return finish(
          state,
          state.players[other].id,
          state.phase === 'challenge' ? 'challenge-timeout' : 'timeout',
        );

      case 'NEXT_GAME':
        // Alternate who starts, keep the series (wins, options, players).
        return freshGame(
          { options: state.options, players: state.players, wins: state.wins, draws: state.draws, gameNumber: state.gameNumber + 1 },
          1 - state.starterIndex,
          now,
        );

      default:
        return state;
    }
  },

  getStatus(state) {
    const nameOf = (id) => state.players.find((p) => p.id === id)?.name ?? '?';
    const over = state.phase === 'over';
    const actor = state.players[state.current];

    let message;
    if (over) {
      const { winnerId, reason } = state.result;
      const winner = winnerId && nameOf(winnerId);
      const loser = winnerId && nameOf(state.players.find((p) => p.id !== winnerId).id);
      message = {
        closed: `${winner} closed the circuit and wins!`,
        'challenge-success': `${winner} answered the challenge and closed the circuit!`,
        'challenge-failed': `${winner} wins. ${loser} could not close the circuit.`,
        'challenge-timeout': `${loser} ran out of time on the challenge. ${winner} wins.`,
        timeout: `${loser} ran out of time. ${winner} wins.`,
        resigned: `${loser} resigned. ${winner} wins.`,
        'deck-empty': 'The deck is empty and the circuit is not closed. Draw.',
      }[reason];
    } else if (state.phase === 'challenge') {
      message = `${nameOf(state.challengerId)} says "no solution". ${actor.name} must close the circuit!`;
    } else {
      message = `${actor.name}'s turn`;
    }

    return {
      isOver: over,
      currentPlayerId: over ? null : actor.id,
      winnerId: state.result?.winnerId ?? null,
      message,
    };
  },
};

function finish(state, winnerId, reason) {
  const wins = { ...state.wins };
  let draws = state.draws;
  if (winnerId) wins[winnerId] += 1;
  else draws += 1;
  return { ...state, wins, draws, phase: 'over', deadline: null, result: { winnerId, reason } };
}
