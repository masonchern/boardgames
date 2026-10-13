/**
 * Close Circuit: authoritative rules (pure functions, no DOM, no Date.now(), no Math.random()).
 *
 * Time and randomness both come from the authority: it stamps every action with `meta.now`
 * and `meta.seed`, and gives `setup` a `now` and a `seed`. Shuffles use a seeded generator,
 * so the same inputs always give the same result (a future server can replay and verify).
 *
 * ============================== NORMAL MODE ==============================
 * - 2 players share one deck of 48 cards. Each card is placed as a straight or a 90-degree turn.
 * - On your turn you place 1 to 3 cards. The very first card of a game goes in the center cell.
 *   After that cards may go ANYWHERE (they need not touch the board), but the cards placed in one
 *   turn must be adjacent to each other and form a straight line (1 to 3 cards in one row or
 *   one column, in any mix of straights and turns). An L shape is not allowed.
 * - After a placement, if every line end on the board connects to another, nothing sticks
 *   out AND all cards form ONE single circuit (no separate loops), the circuit is closed and the
 *   player who just placed wins.
 * - CHALLENGE ("no solution"): instead of placing, the player whose turn it is may challenge.
 *   The opponent then gets (turn time + extra challenge time) to close the circuit, and may use
 *   ALL cards left in the deck, in any shape (the straight-line rule does not apply to them).
 *   Closed -> the challenged player wins. Otherwise (fails, concedes, times out) -> challenger wins.
 * - If the deck runs out without a closed circuit, the game is a draw.
 *
 * ============================= ADVANCED MODE =============================
 * - One shuffled deck of 80 cards: 48 straights, 24 turns (the 72 line cards) and 8 function
 *   cards (4 "limit", 4 "cross"). Each player holds 5 cards; after playing, you draw back up
 *   to 5 (until the deck runs out). Cards in hand have a fixed type; rotation is free.
 * - A turn: play 1-3 cards from your hand (function cards count toward the 3), at least one of
 *   them a straight or turn. Placement: the first card goes in the center, every other card must
 *   touch a card already on the board (including one placed earlier in the same turn), and
 *   several separate loops all count as closed.
 * - LIMIT: the opponent must play exactly 3 straight/turn cards on their next turn (or all the
 *   straight/turn cards in their hand if they hold fewer than 3).
 * - CROSS: turns one straight card on the board (any owner) into an intersection (+) with four
 *   ends, all of which must be connected for the circuit to close.
 * - A hand with no straight or turn card is shuffled back into the deck and redrawn, until it
 *   has at least one (automatic).
 * - CHALLENGE: the challenged player closes the circuit using the straight and turn cards still
 *   in the deck, face up (they pick which, no luck of the draw). Hands are not used.
 * - SOLVE: once 22 or fewer cards remain in the deck, a player may declare "solve" on their turn.
 *   Same as being challenged, but on themselves: closing the circuit wins, failing loses.
 * - When the deck is empty, players play out the cards left in their hands. A player with no
 *   straight or turn card left skips; when neither can play, the game is a draw.
 *
 * ============================ BOTH MODES =================================
 * - Every turn has a time limit (default 30s). Running out of time loses the game.
 *   Either limit can also be switched off: `null` means "no limit" (see normalizeOptions).
 * - The starter alternates every game, and wins are tracked across games.
 *
 * ASSUMPTIONS (the spec was silent; easy to change here):
 * - Normal: the first card still goes in the center (the "no need to touch the board" rule
 *   applies after that); a challenged player may place any number of cards (up to the cards
 *   left in the deck) in any shape.
 * - Advanced: several separate loops count as closed, as long as nothing sticks out.
 * - A challenge or solve is only allowed once there is at least one card on the board.
 * - A player may resign (CONCEDE) at any time on their turn.
 * - Advanced: a challenged/solving player may place any number of pool cards (no 1-3 cap).
 * - Advanced: while limited you cannot challenge or solve (you must play the forced cards).
 * - Advanced: "22 cards remain" means 22 or fewer cards left in the draw deck (all kinds).
 * - Advanced: a cross may target a straight placed earlier in the same turn.
 *
 * STATE:   see `freshGame` below.
 * ACTIONS: PLAY { placements } | CHALLENGE | SOLVE | CONCEDE | TIMEOUT | NEXT_GAME
 *   placement = { kind: 'straight'|'turn', x, y, rot }            (normal mode, and pool plays)
 *             | { kind, x, y, rot, cardId }                       (advanced: card from hand)
 *             | { kind: 'cross', x, y, cardId }                   (advanced: convert a straight)
 *             | { kind: 'limit', cardId }                         (advanced: no target)
 */
import { CARD_KINDS, LINE_KINDS, DX, DY, cellKey, isWinningBoard } from './circuit.js';

export const DEFAULT_OPTIONS = {
  mode: 'normal', // 'normal' | 'advanced'
  turnSeconds: 30, // time per turn (x); null = no limit
  challengeSeconds: 30, // extra time for a challenged player (y); null = no limit
  gridSize: 100,
  deckSize: 48, // normal mode only
  maxPerTurn: 3, // normal mode only
};

/** Advanced-mode constants. */
export const ADVANCED = {
  deck: { straight: 48, turn: 24, limit: 4, cross: 4 },
  handSize: 5,
  maxCards: 3, // cards (of any kind) per turn, and the size of a "limit"
  solveAtDeck: 22, // "solve" unlocks when the deck has this many cards or fewer
};
export const FUNCTION_KINDS = ['limit', 'cross'];

const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Seconds setting: an explicit `null` means "no limit"; a missing/invalid value falls back to the default. */
const seconds = (value, fallback, min, max) => (value === null ? null : clampInt(value, fallback, min, max));

/** Deadline in ms for a turn starting at `now`, or null when there is no limit. */
const deadlineAfter = (now, ...limits) =>
  limits.some((s) => s === null) ? null : now + limits.reduce((sum, s) => sum + s, 0) * 1000;

export function normalizeOptions(o = {}) {
  const d = DEFAULT_OPTIONS;
  return {
    mode: o.mode === 'advanced' ? 'advanced' : 'normal',
    turnSeconds: seconds(o.turnSeconds, d.turnSeconds, 5, 600),
    challengeSeconds: seconds(o.challengeSeconds, d.challengeSeconds, 0, 600),
    gridSize: clampInt(o.gridSize, d.gridSize, 5, 200),
    deckSize: clampInt(o.deckSize, d.deckSize, 1, 200),
    maxPerTurn: clampInt(o.maxPerTurn, d.maxPerTurn, 1, 10),
  };
}

export const centerCell = (gridSize) => Math.floor(gridSize / 2);

// ---------- Seeded randomness (deterministic: same seed, same shuffle) ----------

/** mulberry32: a tiny, good-enough seeded generator returning floats in [0, 1). */
function makeRandom(seed) {
  let a = (Number.isFinite(seed) ? seed : 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle returning a new array. */
function shuffle(list, random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Cards, hands, deck (advanced mode) ----------

const isLineCard = (card) => LINE_KINDS.includes(card.type);
const hasLineCard = (cards) => cards.some(isLineCard);

function buildDeck() {
  const cards = [];
  let n = 0;
  for (const [type, count] of Object.entries(ADVANCED.deck)) {
    for (let i = 0; i < count; i++) cards.push({ id: `c${n++}`, type });
  }
  return cards;
}

/** How many straight / turn cards are still in the deck (what a challenged or solving player may use). */
export function poolCounts(state) {
  const counts = { straight: 0, turn: 0 };
  for (const card of state.deck ?? []) if (card.type in counts) counts[card.type] += 1;
  return counts;
}

/**
 * Refill a player's hand up to the hand size. A hand with no straight or turn card is shuffled
 * back into the deck and redrawn until it has one (or the deck has none left to give).
 */
function drawUp(state, playerId, random) {
  let deck = state.deck.slice();
  let hand = state.hands[playerId].slice();
  const draw = () => {
    while (hand.length < ADVANCED.handSize && deck.length) hand.push(deck.shift());
  };
  draw();

  let redrew = false;
  for (let guard = 0; guard < 200 && !hasLineCard(hand) && hasLineCard(deck); guard++) {
    deck = shuffle([...deck, ...hand], random);
    hand = [];
    draw();
    redrew = true;
  }

  const name = state.players.find((p) => p.id === playerId).name;
  return {
    ...state,
    deck,
    deckRemaining: deck.length,
    hands: { ...state.hands, [playerId]: hand },
    notice: redrew ? `${name} had no straight or turn card, so they shuffled their hand back and drew again.` : state.notice,
  };
}

/** The number of straight/turn cards `playerId` must play this turn if limited, else null. */
export function limitRequirement(state, playerId) {
  if (state.options.mode !== 'advanced' || state.limitedPlayerId !== playerId) return null;
  return Math.min(ADVANCED.maxCards, state.hands[playerId].filter(isLineCard).length);
}

// ---------- State ----------

/** State for the start of a new game, keeping series info (wins, players, options). */
function freshGame(series, starterIndex, now, random) {
  const { options } = series;
  const base = {
    ...series,
    starterIndex,
    board: {}, // "x,y" -> { x, y, kind, rot, owner, turn }
    turnNumber: 1,
    phase: 'play', // 'play' | 'challenge' | 'solve' | 'over'
    current: starterIndex, // index of the player who must act (the responder during a challenge)
    challengerId: null, // the challenger, or the player who said "solve"
    turnStartedAt: now,
    deadline: deadlineAfter(now, options.turnSeconds), // null = no time limit
    result: null, // { winnerId: string|null, reason: string } once over
    lastPlaced: [], // keys of the cards placed in the most recent move
    notice: null, // one-off message about something that just happened (skips, redraws)
  };

  if (options.mode !== 'advanced') {
    return { ...base, deckRemaining: options.deckSize, deckTotal: options.deckSize };
  }

  const deck = shuffle(buildDeck(), random);
  let state = {
    ...base,
    deck, // draw from the front; cards here are face down, except the straight/turn counts in a challenge
    deckRemaining: deck.length,
    deckTotal: deck.length,
    hands: Object.fromEntries(series.players.map((p) => [p.id, []])),
    limitedPlayerId: null, // the player who must play exactly 3 cards on their next turn
  };
  for (const p of series.players) state = drawUp(state, p.id, random);
  return state;
}

// ---------- Placement ----------

/** Apply placements to a board (a copy). Limit cards have no board effect. */
function applyItems(board, items, owner = null, turn = 0) {
  const next = { ...board };
  for (const it of items) {
    if (it.kind === 'limit') continue;
    const key = cellKey(it.x, it.y);
    if (it.kind === 'cross') next[key] = { ...next[key], kind: 'cross', rot: 0 };
    else next[key] = { x: it.x, y: it.y, kind: it.kind, rot: it.rot, owner, turn };
  }
  return next;
}

/**
 * Why `item` cannot be played right now (given items `placed` earlier in the same turn),
 * or null if it is legal. The view uses this too, so UI and rules always agree.
 * This checks the board only; hands and card counts are checked by the whole-turn validation.
 */
export function placementProblem(state, placed, item) {
  const { x, y, kind, rot } = item;
  const { gridSize, mode } = state.options;

  if (kind === 'limit') return mode === 'advanced' ? null : 'Function cards are only used in advanced mode';
  if (!CARD_KINDS[kind]) return 'Unknown card type';
  if (kind === 'cross' && mode !== 'advanced') return 'Intersections are only used in advanced mode';

  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'Invalid cell';
  if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) return 'Outside the grid';

  const board = applyItems(state.board, placed);
  const here = board[cellKey(x, y)];

  if (kind === 'cross') {
    if (!here) return 'Pick a straight line that is already on the board';
    return here.kind === 'straight' ? null : 'Only a straight line can become an intersection';
  }

  if (!Number.isInteger(rot) || rot < 0 || rot >= CARD_KINDS[kind].rotations) return 'Invalid rotation';
  if (here) return 'That cell is already occupied';

  if (Object.keys(board).length === 0) {
    const c = centerCell(gridSize);
    return x === c && y === c ? null : 'The first card must go in the center cell';
  }

  if (mode === 'advanced') {
    const touches = [0, 1, 2, 3].some((d) => board[cellKey(x + DX[d], y + DY[d])]);
    return touches ? null : 'Cards must touch a card that is already on the board';
  }

  // Normal mode: cards may go anywhere, but one turn's cards form a straight line of adjacent cells.
  // A challenged player is exempt: they may build any shape with the cards left in the deck.
  if (state.phase === 'challenge') return null;
  if (placed.length === 0) return null;
  const mine = placed.filter((p) => Number.isInteger(p.x) && Number.isInteger(p.y));
  if (mine.length === 0) return null;
  if (mine.length === 1) {
    const [first] = mine;
    return Math.abs(first.x - x) + Math.abs(first.y - y) === 1 ? null : 'This turn\'s cards must be next to each other';
  }
  // Two or more cards already fix a row or a column; the new one must extend that line.
  const horizontal = mine.every((p) => p.y === mine[0].y);
  const lineCells = mine.map((p) => (horizontal ? p.x : p.y));
  const pos = horizontal ? x : y;
  if ((horizontal ? y : x) !== (horizontal ? mine[0].y : mine[0].x)) return 'This turn\'s cards must form a straight line (no L shapes)';
  return pos === Math.min(...lineCells) - 1 || pos === Math.max(...lineCells) + 1
    ? null
    : 'This turn\'s cards must be next to each other in a straight line';
}

/** Validate a whole turn (card counts, hand contents, limit, then each placement in order). */
function playProblem(state, playerId, items) {
  if (!Array.isArray(items)) return 'Missing placements';
  const advanced = state.options.mode === 'advanced';
  const fromPool = state.phase === 'challenge' || state.phase === 'solve';

  if (!advanced) {
    // A challenged player may use every card left in the deck; otherwise 1 to maxPerTurn.
    const limit = state.phase === 'challenge' ? state.deckRemaining : Math.min(state.options.maxPerTurn, state.deckRemaining);
    if (items.length < 1) return 'Place at least 1 card';
    if (items.length > limit) return `You can place at most ${limit} card${limit === 1 ? '' : 's'}`;
    if (items.some((i) => !LINE_KINDS.includes(i.kind))) return 'Unknown card type';
  } else if (fromPool) {
    if (items.length < 1) return 'Place at least 1 card';
    const pool = poolCounts(state);
    const used = { straight: 0, turn: 0 };
    for (const it of items) {
      if (!LINE_KINDS.includes(it.kind)) return 'Only straight and turn cards can be used here';
      used[it.kind] += 1;
      if (used[it.kind] > pool[it.kind]) return `There are no more ${it.kind} cards left in the deck`;
    }
  } else {
    const hand = state.hands[playerId];
    if (items.length < 1) return 'Play at least 1 card';
    if (items.length > ADVANCED.maxCards) return `You can play at most ${ADVANCED.maxCards} cards`;
    const seen = new Set();
    for (const it of items) {
      const card = hand.find((c) => c.id === it.cardId);
      if (!card) return 'That card is not in your hand';
      if (seen.has(card.id)) return 'A card can only be played once';
      seen.add(card.id);
      if (card.type !== it.kind) return 'That card is a different type';
    }
    const lines = items.filter((i) => LINE_KINDS.includes(i.kind)).length;
    if (lines < 1) return 'Play at least one straight or turn card';
    const need = limitRequirement(state, playerId);
    if (need !== null && lines !== need) {
      return `Limited! You must play exactly ${need} straight/turn card${need === 1 ? '' : 's'} this turn`;
    }
  }

  const placed = [];
  for (const it of items) {
    const problem = placementProblem(state, placed, it);
    if (problem) return problem;
    placed.push(it);
  }
  return null;
}

const isActive = (state) => state.phase === 'play' || state.phase === 'challenge' || state.phase === 'solve';

/**
 * Hand the turn to player `index` (advanced mode). A player with no straight or turn card
 * cannot play: they skip, or if neither player can play, the game is a draw.
 */
function startTurn(state, index, now) {
  const canAct = (i) => hasLineCard(state.hands[state.players[i].id]);
  let current = index;
  let { notice, limitedPlayerId } = state;

  if (!canAct(current)) {
    if (!canAct(1 - current)) return finish(state, null, 'no-cards');
    const skipped = state.players[current];
    notice = `${skipped.name} has no straight or turn card left and skips.`;
    if (limitedPlayerId === skipped.id) limitedPlayerId = null;
    current = 1 - current;
  }
  return {
    ...state,
    current,
    notice,
    limitedPlayerId,
    turnNumber: state.turnNumber + 1,
    turnStartedAt: now,
    deadline: deadlineAfter(now, state.options.turnSeconds),
  };
}

/** @type {import('../../core/types.js').GameRules} */
export const rules = {
  setup({ players, options, now = 0, seed = 1 }) {
    const series = {
      options: normalizeOptions(options),
      players: players.slice(0, 2).map((p) => ({ id: p.id, name: p.name })),
      wins: Object.fromEntries(players.slice(0, 2).map((p) => [p.id, 0])),
      draws: 0,
      gameNumber: 1,
    };
    return freshGame(series, 0, now, makeRandom(seed));
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
      if (state.deadline === null) return fail('There is no time limit');
      return meta && meta.now >= state.deadline ? ok : fail('The timer has not expired yet');
    }

    if (state.players[state.current].id !== playerId) return fail('Not your turn');

    switch (action.type) {
      case 'PLAY': {
        const problem = playProblem(state, playerId, action.placements);
        return problem ? fail(problem) : ok;
      }
      case 'CHALLENGE':
        if (state.phase !== 'play') return fail('You cannot challenge right now');
        if (Object.keys(state.board).length === 0) return fail('Nothing to challenge yet');
        if (limitRequirement(state, playerId) !== null) return fail('You are limited: you must play your cards');
        return ok;
      case 'SOLVE':
        if (state.options.mode !== 'advanced') return fail('Solve is only available in advanced mode');
        if (state.phase !== 'play') return fail('You cannot solve right now');
        if (state.deckRemaining > ADVANCED.solveAtDeck) {
          return fail(`Solve unlocks when ${ADVANCED.solveAtDeck} or fewer cards remain in the deck`);
        }
        if (Object.keys(state.board).length === 0) return fail('Nothing to solve yet');
        if (limitRequirement(state, playerId) !== null) return fail('You are limited: you must play your cards');
        return ok;
      case 'CONCEDE':
        return ok;
      default:
        return fail('Unknown action');
    }
  },

  reduce(state, action, playerId, meta) {
    const now = meta?.now ?? 0;
    const random = makeRandom(meta?.seed ?? 1);
    const other = 1 - state.current;
    const advanced = state.options.mode === 'advanced';

    switch (action.type) {
      case 'PLAY': {
        const items = action.placements;
        const board = applyItems(state.board, items, playerId, state.turnNumber);
        let next = {
          ...state,
          board,
          lastPlaced: items.filter((i) => i.kind !== 'limit').map((i) => cellKey(i.x, i.y)),
          notice: null,
        };

        if (!advanced) {
          next.deckRemaining = state.deckRemaining - items.length;
        } else if (state.phase === 'play') {
          // The cards leave the hand. Playing "limit" limits the opponent's next turn.
          const used = new Set(items.map((i) => i.cardId));
          next.hands = { ...state.hands, [playerId]: state.hands[playerId].filter((c) => !used.has(c.id)) };
          if (state.limitedPlayerId === playerId) next.limitedPlayerId = null;
          if (items.some((i) => i.kind === 'limit')) next.limitedPlayerId = state.players[other].id;
        } else {
          // Challenge or solve: the cards come out of the face-up deck.
          const deck = state.deck.slice();
          for (const it of items) deck.splice(deck.findIndex((c) => c.type === it.kind), 1);
          next.deck = deck;
          next.deckRemaining = deck.length;
        }

        const closed = isWinningBoard(board, state.options);

        if (state.phase === 'challenge') {
          // The challenged player gets exactly one attempt.
          return closed
            ? finish(next, playerId, 'challenge-success')
            : finish(next, state.challengerId, 'challenge-failed');
        }
        if (state.phase === 'solve') {
          return closed
            ? finish(next, playerId, 'solve-success')
            : finish(next, state.players[other].id, 'solve-failed');
        }
        if (closed) return finish(next, playerId, 'closed');

        if (!advanced) {
          if (next.deckRemaining === 0) return finish(next, null, 'deck-empty');
          return {
            ...next,
            current: other,
            turnNumber: state.turnNumber + 1,
            turnStartedAt: now,
            deadline: deadlineAfter(now, state.options.turnSeconds),
          };
        }

        next = drawUp(next, playerId, random);
        return startTurn(next, other, now);
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
          notice: null,
          // turn time + extra time; no limit if either one is switched off
          deadline: deadlineAfter(now, turnSeconds, challengeSeconds),
        };
      }

      case 'SOLVE': {
        const { turnSeconds, challengeSeconds } = state.options;
        return {
          ...state,
          phase: 'solve',
          challengerId: playerId, // here: the player who is trying to solve
          // `current` stays: the solver is the one who acts
          turnNumber: state.turnNumber + 1,
          turnStartedAt: now,
          notice: null,
          deadline: deadlineAfter(now, turnSeconds, challengeSeconds),
        };
      }

      case 'CONCEDE':
        return finish(
          state,
          state.players[other].id,
          { challenge: 'challenge-failed', solve: 'solve-failed' }[state.phase] ?? 'resigned',
        );

      case 'TIMEOUT':
        return finish(
          state,
          state.players[other].id,
          { challenge: 'challenge-timeout', solve: 'solve-timeout' }[state.phase] ?? 'timeout',
        );

      case 'NEXT_GAME':
        // Alternate who starts, keep the series (wins, options, players).
        return freshGame(
          { options: state.options, players: state.players, wins: state.wins, draws: state.draws, gameNumber: state.gameNumber + 1 },
          1 - state.starterIndex,
          now,
          random,
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
        'solve-success': `${winner} solved it and closed the circuit!`,
        'solve-failed': `${winner} wins. ${loser} could not solve the circuit.`,
        'solve-timeout': `${loser} ran out of time while solving. ${winner} wins.`,
        timeout: `${loser} ran out of time. ${winner} wins.`,
        resigned: `${loser} resigned. ${winner} wins.`,
        'deck-empty': 'The deck is empty and the circuit is not closed. Draw.',
        'no-cards': 'Nobody has a straight or turn card left to play. Draw.',
      }[reason];
    } else if (state.phase === 'challenge') {
      message = `${nameOf(state.challengerId)} says "no solution". ${actor.name} must close the circuit!`;
    } else if (state.phase === 'solve') {
      message = `${actor.name} says "solve" and must close the circuit with the cards left in the deck!`;
    } else {
      const need = limitRequirement(state, actor.id);
      message = need === null
        ? `${actor.name}'s turn`
        : `${actor.name}'s turn. Limited: must play ${need} straight/turn card${need === 1 ? '' : 's'}`;
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
