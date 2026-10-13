import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from './rules.js';
import { cellKey, isClosed, isWinningBoard, isOneGroup } from './circuit.js';

const players = [
  { id: 'p1', name: 'Player 1' },
  { id: 'p2', name: 'Player 2' },
];
const T0 = 1_000_000;

const newGame = (options) => rules.setup({ players, options, now: T0 });

/** Validate + reduce, failing the test if the action is rejected. */
function act(state, playerId, action, now = T0 + 1000) {
  const verdict = rules.validate(state, action, playerId, { now });
  assert.ok(verdict.ok, `expected ${action.type} to be valid, got: ${verdict.error}`);
  return rules.reduce(state, action, playerId, { now });
}

const reject = (state, playerId, action, now = T0 + 1000) =>
  rules.validate(state, action, playerId, { now });

// A 2x2 square around the center cell (50,50).
const SQUARE = [
  { x: 50, y: 50, kind: 'turn', rot: 1 }, // ends E,S
  { x: 51, y: 50, kind: 'turn', rot: 2 }, // ends S,W
  { x: 50, y: 51, kind: 'turn', rot: 0 }, // ends N,E
  { x: 51, y: 51, kind: 'turn', rot: 3 }, // ends W,N
];
// The square is played as two straight rows over two turns (an L is not allowed in one turn).
const TOP = SQUARE.slice(0, 2);
const BOTTOM = SQUARE.slice(2, 4);
const ROW3 = [50, 51, 52].map((x) => ({ x, y: 50, kind: 'straight', rot: 0 }));

test('setup uses defaults: 48 cards, 100x100 grid, 30s + 30s', () => {
  const s = newGame();
  assert.equal(s.deckRemaining, 48);
  assert.equal(s.options.gridSize, 100);
  assert.equal(s.options.turnSeconds, 30);
  assert.equal(s.options.challengeSeconds, 30);
  assert.equal(s.phase, 'play');
  assert.equal(rules.getStatus(s).currentPlayerId, 'p1');
});

test('first card must be in the center; later cards may go anywhere', () => {
  const s = newGame();
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [{ x: 10, y: 10, kind: 'straight', rot: 0 }] }).ok, false);
  const afterCenter = act(s, 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] });
  assert.ok(afterCenter.board[cellKey(50, 50)]);
  assert.equal(afterCenter.deckRemaining, 47);

  // p2 places a card that touches nothing: allowed in normal mode
  const far = act(afterCenter, 'p2', { type: 'PLAY', placements: [{ x: 60, y: 60, kind: 'turn', rot: 0 }] });
  assert.ok(far.board[cellKey(60, 60)]);
});

test('one turn: the cards must be adjacent and in a straight line (no L shapes)', () => {
  const s = act(newGame(), 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] });
  const t = (x, y, kind = 'straight') => ({ x, y, kind, rot: 0 });
  const play = (placements) => reject(s, 'p2', { type: 'PLAY', placements });

  // anywhere on the board, as long as the turn's cards form one straight line
  assert.equal(play([t(70, 70)]).ok, true);
  assert.equal(play([t(70, 70), t(71, 70)]).ok, true);
  assert.equal(play([t(70, 70), t(70, 71), t(70, 72)]).ok, true); // vertical
  assert.equal(play([t(70, 70), t(71, 70, 'turn'), t(72, 70)]).ok, true); // line, turn, line
  assert.equal(play([t(71, 70), t(70, 70), t(72, 70)]).ok, true); // any order that stays connected
  assert.equal(play([t(70, 70), t(71, 70), t(69, 70)]).ok, true); // extend either end

  // an L is not allowed, nor are gaps or diagonals
  assert.equal(play([t(70, 70), t(71, 70), t(71, 71)]).ok, false);
  assert.equal(play([t(70, 70), t(70, 71), t(71, 71)]).ok, false);
  assert.equal(play([t(70, 70), t(72, 70)]).ok, false);
  assert.equal(play([t(70, 70), t(71, 71)]).ok, false);
  assert.equal(play([t(70, 70), t(71, 70), t(71, 69)]).ok, false);

  // a challenged player is exempt: any shape, any number of cards, up to the cards left in the deck
  const challenged = act(s, 'p2', { type: 'CHALLENGE' });
  assert.equal(reject(challenged, 'p1', { type: 'PLAY', placements: [t(70, 70), t(71, 70), t(71, 71)] }).ok, true);
  assert.equal(reject(challenged, 'p1', { type: 'PLAY', placements: [t(70, 70), t(80, 80)] }).ok, true);
  const many = Array.from({ length: challenged.deckRemaining }, (_, i) => t(60 + (i % 20), 70 + Math.floor(i / 20)));
  assert.equal(reject(challenged, 'p1', { type: 'PLAY', placements: many }).ok, true); // the whole deck
  assert.equal(reject(challenged, 'p1', { type: 'PLAY', placements: [...many, t(10, 10)] }).ok, false); // one too many
  assert.equal(reject(challenged, 'p1', { type: 'PLAY', placements: [t(50, 50)] }).ok, false); // still no overlapping
});

test('challenge (normal): the challenged player can build a loop with many cards and wins', () => {
  // p1 plays 2 cards of a 2x3 rectangle; p2 challenges; p1 finishes the rest in an L-shaped, multi-card play
  const rectangle = [
    { x: 50, y: 50, kind: 'turn', rot: 1 },
    { x: 51, y: 50, kind: 'straight', rot: 0 },
    { x: 52, y: 50, kind: 'turn', rot: 2 },
    { x: 50, y: 51, kind: 'turn', rot: 0 },
    { x: 51, y: 51, kind: 'straight', rot: 0 },
    { x: 52, y: 51, kind: 'turn', rot: 3 },
  ];
  let s = act(newGame(), 'p1', { type: 'PLAY', placements: rectangle.slice(0, 2) });
  s = act(s, 'p2', { type: 'CHALLENGE' });
  // 4 cards at once, in an L-shaped pattern: not allowed for a normal turn, fine when challenged
  s = act(s, 'p1', { type: 'PLAY', placements: rectangle.slice(2) });
  assert.equal(s.result.winnerId, 'p1');
  assert.equal(s.result.reason, 'challenge-success');
});

test('one turn: 1 to 3 cards, chained placements allowed', () => {
  const s = newGame();
  const four = [50, 51, 52, 53].map((x) => ({ x, y: 50, kind: 'straight', rot: 0 }));
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: four }).ok, false); // too many
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [] }).ok, false); // too few
  const three = act(s, 'p1', { type: 'PLAY', placements: ROW3 });
  assert.equal(three.deckRemaining, 45);
  assert.equal(rules.getStatus(three).currentPlayerId, 'p2');
});

test('rejects overlapping cards and playing out of turn', () => {
  const s = act(newGame(), 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] });
  assert.equal(reject(s, 'p2', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'turn', rot: 0 }] }).ok, false);
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [{ x: 51, y: 50, kind: 'turn', rot: 0 }] }).ok, false);
});

test('closing a circuit wins the game and counts a win', () => {
  let s = act(newGame(), 'p1', { type: 'PLAY', placements: TOP });
  assert.equal(s.phase, 'play');
  s = act(s, 'p2', { type: 'PLAY', placements: BOTTOM });
  assert.equal(s.phase, 'over');
  assert.equal(s.result.winnerId, 'p2');
  assert.equal(s.result.reason, 'closed');
  assert.equal(s.wins.p2, 1);
  assert.equal(s.wins.p1, 0);
});

test('circuit detection: square and rectangle are closed, a line and an L are not', () => {
  const toBoard = (list) => Object.fromEntries(list.map((p) => [cellKey(p.x, p.y), p]));
  assert.equal(isClosed(toBoard(SQUARE)), true);

  const rectangle = [
    { x: 50, y: 50, kind: 'turn', rot: 1 },
    { x: 51, y: 50, kind: 'straight', rot: 0 },
    { x: 52, y: 50, kind: 'turn', rot: 2 },
    { x: 50, y: 51, kind: 'turn', rot: 0 },
    { x: 51, y: 51, kind: 'straight', rot: 0 },
    { x: 52, y: 51, kind: 'turn', rot: 3 },
  ];
  assert.equal(isClosed(toBoard(rectangle)), true);

  assert.equal(isClosed({}), false);
  assert.equal(isClosed(toBoard([{ x: 50, y: 50, kind: 'straight', rot: 0 }])), false);
  assert.equal(isClosed(toBoard(SQUARE.slice(0, 3))), false);
  assert.equal(isOneGroup(toBoard(SQUARE)), true);
  // right shape, wrong orientation: one corner points the wrong way
  const wrong = SQUARE.map((p, i) => (i === 3 ? { ...p, rot: 0 } : p));
  assert.equal(isClosed(toBoard(wrong)), false);
});

test('normal mode: the circuit must contain every card (separate loops or stray cards do not win)', () => {
  const shift = (list, dx, dy) => list.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  const toBoard = (list) => Object.fromEntries(list.map((p) => [cellKey(p.x, p.y), p]));
  const twoSquares = toBoard([...SQUARE, ...shift(SQUARE, 10, 10)]);
  assert.equal(isClosed(twoSquares), true); // nothing sticks out...
  assert.equal(isOneGroup(twoSquares), false); // ...but it is two loops
  assert.equal(isWinningBoard(twoSquares, { mode: 'normal' }), false);
  assert.equal(isWinningBoard(twoSquares, {}), false);
  // advanced mode keeps its own rule: separate loops all count
  assert.equal(isWinningBoard(twoSquares, { mode: 'advanced' }), true);
  assert.equal(isWinningBoard(toBoard(SQUARE), { mode: 'normal' }), true);

  // In play: a closed square next to a stray card with open ends does not end the game
  let s = act(newGame(), 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] });
  s = act(s, 'p2', { type: 'PLAY', placements: shift(TOP, 10, 10) });
  s = act(s, 'p1', { type: 'PLAY', placements: shift(BOTTOM, 10, 10) });
  assert.equal(s.phase, 'play');
  assert.equal(s.result, null);
});

test('challenge: challenged player closes the circuit and wins', () => {
  let s = act(newGame(), 'p1', { type: 'PLAY', placements: TOP });
  s = act(s, 'p2', { type: 'CHALLENGE' });
  assert.equal(s.phase, 'challenge');
  assert.equal(rules.getStatus(s).currentPlayerId, 'p1'); // p1 is the one being challenged
  // challenged player gets x + y seconds
  assert.equal(s.deadline - s.turnStartedAt, (30 + 30) * 1000);

  s = act(s, 'p1', { type: 'PLAY', placements: BOTTOM });
  assert.equal(s.result.winnerId, 'p1');
  assert.equal(s.result.reason, 'challenge-success');
});

test('challenge: challenged player fails, challenger wins', () => {
  let s = act(newGame(), 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] });
  s = act(s, 'p2', { type: 'CHALLENGE' });
  s = act(s, 'p1', { type: 'PLAY', placements: [{ x: 51, y: 50, kind: 'straight', rot: 0 }] });
  assert.equal(s.result.winnerId, 'p2');
  assert.equal(s.result.reason, 'challenge-failed');
});

test('challenge rules: not on an empty board, not twice, conceding gives the win away', () => {
  const empty = newGame();
  assert.equal(reject(empty, 'p1', { type: 'CHALLENGE' }).ok, false);

  let s = act(empty, 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] });
  s = act(s, 'p2', { type: 'CHALLENGE' });
  assert.equal(reject(s, 'p1', { type: 'CHALLENGE' }).ok, false);
  s = act(s, 'p1', { type: 'CONCEDE' });
  assert.equal(s.result.winnerId, 'p2');
});

test('forfeit awards the win to the other player even when it is not their turn', () => {
  const s = newGame();
  assert.equal(s.players[s.current].id, 'p1');
  const lost = act(s, 'p2', { type: 'FORFEIT' });
  assert.equal(lost.phase, 'over');
  assert.equal(lost.result.winnerId, 'p1');
  assert.equal(lost.result.reason, 'disconnected');
  assert.equal(lost.wins.p1, 1);
});

test('timers: variable settings, and timeouts only count after the deadline', () => {
  const s = newGame({ turnSeconds: 10, challengeSeconds: 5 });
  assert.equal(s.deadline - T0, 10_000);
  assert.equal(reject(s, 'p1', { type: 'TIMEOUT' }, T0 + 9_999).ok, false);
  const lost = act(s, 'p1', { type: 'TIMEOUT' }, T0 + 10_000);
  assert.equal(lost.result.winnerId, 'p2');
  assert.equal(lost.result.reason, 'timeout');

  // each new turn restarts the clock from the time of the action
  const moved = act(s, 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] }, T0 + 4_000);
  assert.equal(moved.deadline, T0 + 4_000 + 10_000);

  const challenged = act(moved, 'p2', { type: 'CHALLENGE' }, T0 + 6_000);
  assert.equal(challenged.deadline, T0 + 6_000 + 15_000);
});

test('no time limit: null turn time means no deadline and no timeouts', () => {
  const s = newGame({ turnSeconds: null });
  assert.equal(s.options.turnSeconds, null);
  assert.equal(s.deadline, null);
  assert.equal(reject(s, 'p1', { type: 'TIMEOUT' }, T0 + 10 ** 9).ok, false);

  // the game still works, and later turns stay unlimited, including after a challenge
  let moved = act(s, 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] });
  assert.equal(moved.deadline, null);
  moved = act(moved, 'p2', { type: 'CHALLENGE' });
  assert.equal(moved.phase, 'challenge');
  assert.equal(moved.deadline, null);
});

test('no limit on the extra challenge time only affects challenged players', () => {
  const s = newGame({ turnSeconds: 10, challengeSeconds: null });
  assert.equal(s.options.challengeSeconds, null);
  assert.equal(s.deadline, T0 + 10_000); // normal turns are still timed

  let moved = act(s, 'p1', { type: 'PLAY', placements: [{ x: 50, y: 50, kind: 'straight', rot: 0 }] }, T0 + 1_000);
  assert.equal(moved.deadline, T0 + 11_000);
  moved = act(moved, 'p2', { type: 'CHALLENGE' }, T0 + 2_000);
  assert.equal(moved.deadline, null); // the challenged player has all the time they need
});

test('missing or invalid time settings fall back to the 30 second defaults', () => {
  for (const options of [undefined, {}, { turnSeconds: 'abc', challengeSeconds: undefined }]) {
    const s = newGame(options);
    assert.equal(s.options.turnSeconds, 30);
    assert.equal(s.options.challengeSeconds, 30);
  }
});

test('next game: starter alternates and wins carry over', () => {
  let s = act(newGame(), 'p1', { type: 'PLAY', placements: TOP });
  s = act(s, 'p2', { type: 'PLAY', placements: BOTTOM });
  assert.equal(reject(newGame(), 'p1', { type: 'NEXT_GAME' }).ok, false); // only after a game ends

  const next = act(s, 'p1', { type: 'NEXT_GAME' });
  assert.equal(next.gameNumber, 2);
  assert.equal(next.phase, 'play');
  assert.equal(next.deckRemaining, 48);
  assert.deepEqual(next.board, {});
  assert.equal(next.wins.p2, 1);
  assert.equal(rules.getStatus(next).currentPlayerId, 'p2'); // player 2 starts game 2
});

test('empty deck without a closed circuit is a draw', () => {
  const s = newGame({ deckSize: 3 });
  const done = act(s, 'p1', { type: 'PLAY', placements: ROW3 });
  assert.equal(done.phase, 'over');
  assert.equal(done.result.winnerId, null);
  assert.equal(done.result.reason, 'deck-empty');
  assert.equal(done.draws, 1);
});

test('reduce never mutates the previous state', () => {
  const s = newGame();
  const snapshot = JSON.stringify(s);
  act(s, 'p1', { type: 'PLAY', placements: ROW3 });
  assert.equal(JSON.stringify(s), snapshot);
});
