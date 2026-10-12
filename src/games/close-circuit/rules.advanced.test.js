import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules, ADVANCED, poolCounts, limitRequirement } from './rules.js';
import { cellKey, isClosed, openEnds } from './circuit.js';

const players = [
  { id: 'p1', name: 'Player 1' },
  { id: 'p2', name: 'Player 2' },
];
const T0 = 1_000_000;

const newGame = (seed = 7, options = {}) =>
  rules.setup({ players, options: { mode: 'advanced', ...options }, now: T0, seed });

function act(state, playerId, action, meta = {}) {
  const m = { now: T0 + 1000, seed: 99, ...meta };
  const verdict = rules.validate(state, action, playerId, m);
  assert.ok(verdict.ok, `expected ${action.type} to be valid, got: ${verdict.error}`);
  return rules.reduce(state, action, playerId, m);
}
const reject = (state, playerId, action, meta = {}) =>
  rules.validate(state, action, playerId, { now: T0 + 1000, seed: 99, ...meta });

/** A card, plus helpers to build a hand-picked state. */
let nextId = 1000;
const card = (type) => ({ id: `t${nextId++}`, type });
const cards = (...types) => types.map(card);

/** Replace hands/deck in a state (keeping the counters consistent). */
function rig(state, { p1, p2, deck }) {
  const next = { ...state, hands: { p1: p1 ?? state.hands.p1, p2: p2 ?? state.hands.p2 } };
  if (deck) {
    next.deck = deck;
    next.deckRemaining = deck.length;
  }
  return next;
}

const count = (list, type) => list.filter((c) => c.type === type).length;

// A 2x2 square around the center cell (50,50), as turn cards.
const SQUARE = [
  { kind: 'turn', x: 50, y: 50, rot: 1 },
  { kind: 'turn', x: 51, y: 50, rot: 2 },
  { kind: 'turn', x: 50, y: 51, rot: 0 },
  { kind: 'turn', x: 51, y: 51, rot: 3 },
];
/** Attach hand card ids to placements, one card of the right type per placement. */
const withCards = (placements, hand) => {
  const free = [...hand];
  return placements.map((p) => {
    const i = free.findIndex((c) => c.type === p.kind);
    return { ...p, cardId: free.splice(i, 1)[0].id };
  });
};

test('advanced setup: 80-card deck, 5-card hands, nothing hidden is missing', () => {
  const s = newGame();
  assert.equal(s.options.mode, 'advanced');
  assert.equal(s.deckTotal, 80);
  assert.equal(s.hands.p1.length, ADVANCED.handSize);
  assert.equal(s.hands.p2.length, ADVANCED.handSize);
  assert.equal(s.deckRemaining, 70);
  assert.equal(s.deck.length, 70);

  const all = [...s.deck, ...s.hands.p1, ...s.hands.p2];
  assert.equal(all.length, 80);
  assert.equal(count(all, 'straight'), 48);
  assert.equal(count(all, 'turn'), 24);
  assert.equal(count(all, 'limit'), 4);
  assert.equal(count(all, 'cross'), 4);
  assert.equal(new Set(all.map((c) => c.id)).size, 80); // unique ids
});

test('the shuffle is seeded: same seed, same deal; different seed, different deal', () => {
  const a = JSON.stringify(newGame(1).hands);
  assert.equal(JSON.stringify(newGame(1).hands), a);
  assert.notEqual(JSON.stringify(newGame(2).hands), a);
});

test('every dealt hand has at least one straight or turn card', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const s = newGame(seed);
    for (const id of ['p1', 'p2']) {
      assert.ok(s.hands[id].some((c) => c.type === 'straight' || c.type === 'turn'), `seed ${seed} ${id}`);
    }
  }
});

test('playing cards removes them from the hand and refills it to 5', () => {
  const hand = cards('straight', 'straight', 'turn', 'turn', 'turn');
  const deck = cards('straight', 'turn', 'limit', 'cross', 'straight', 'turn');
  let s = rig(newGame(), { p1: hand, deck });
  const play = withCards([{ kind: 'straight', x: 50, y: 50, rot: 0 }, { kind: 'turn', x: 51, y: 50, rot: 0 }], hand);
  s = act(s, 'p1', { type: 'PLAY', placements: play });
  assert.equal(s.hands.p1.length, 5);
  assert.equal(s.deckRemaining, 4); // two drawn
  assert.ok(!s.hands.p1.some((c) => play.some((p) => p.cardId === c.id)));
  assert.equal(rules.getStatus(s).currentPlayerId, 'p2');
});

test('hand rules: only cards you hold, 1-3 cards, at least one straight or turn', () => {
  const hand = cards('straight', 'turn', 'limit', 'cross', 'straight');
  const s = rig(newGame(), { p1: hand });
  const one = { kind: 'straight', x: 50, y: 50, rot: 0, cardId: hand[0].id };

  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [{ ...one, cardId: 'nope' }] }).ok, false);
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [] }).ok, false);
  // wrong type for the card
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [{ ...one, kind: 'turn' }] }).ok, false);
  // the same card twice
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [one, { ...one, x: 51, y: 50 }] }).ok, false);
  // a function card alone is not a play
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [{ kind: 'limit', cardId: hand[2].id }] }).ok, false);
  // four cards is too many
  const four = [
    one,
    { kind: 'turn', x: 51, y: 50, rot: 0, cardId: hand[1].id },
    { kind: 'limit', cardId: hand[2].id },
    { kind: 'straight', x: 52, y: 50, rot: 0, cardId: hand[4].id },
  ];
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: four }).ok, false);
  // function cards count toward the 3: a straight, a turn and the limit is fine
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: four.slice(0, 3) }).ok, true);
});

test('a hand with no straight or turn is shuffled back and redrawn', () => {
  // After playing the straight, p1 draws a function card and holds only function cards.
  const hand = cards('straight', 'limit', 'limit', 'cross', 'cross');
  const deck = [card('limit'), ...cards('straight', 'turn', 'straight', 'turn', 'straight', 'turn')];
  let s = rig(newGame(), { p1: hand, deck });
  s = act(s, 'p1', { type: 'PLAY', placements: [{ kind: 'straight', x: 50, y: 50, rot: 0, cardId: hand[0].id }] });
  assert.equal(s.hands.p1.length, 5);
  assert.ok(s.hands.p1.some((c) => c.type === 'straight' || c.type === 'turn'));
  assert.match(s.notice, /drew again/);
  // no card was lost or duplicated
  const all = [...s.deck, ...s.hands.p1, ...s.hands.p2];
  assert.equal(new Set(all.map((c) => c.id)).size, all.length);
});

test('limit: the opponent must play exactly 3 straight/turn cards next turn', () => {
  const p1 = cards('straight', 'limit', 'straight', 'turn', 'turn');
  const p2 = cards('straight', 'straight', 'turn', 'turn', 'turn');
  let s = rig(newGame(), { p1, p2 });

  s = act(s, 'p1', {
    type: 'PLAY',
    placements: [
      { kind: 'straight', x: 50, y: 50, rot: 0, cardId: p1[0].id },
      { kind: 'limit', cardId: p1[1].id },
    ],
  });
  assert.equal(s.limitedPlayerId, 'p2');
  assert.equal(limitRequirement(s, 'p2'), 3);
  assert.match(rules.getStatus(s).message, /Limited/);

  const play = (n) =>
    withCards(
      [
        { kind: 'straight', x: 51, y: 50, rot: 0 },
        { kind: 'straight', x: 52, y: 50, rot: 0 },
        { kind: 'turn', x: 53, y: 50, rot: 0 },
      ].slice(0, n),
      s.hands.p2,
    );
  assert.equal(reject(s, 'p2', { type: 'PLAY', placements: play(2) }).ok, false);
  assert.equal(reject(s, 'p2', { type: 'CHALLENGE' }).ok, false); // no escape by challenging
  assert.equal(reject(s, 'p2', { type: 'CONCEDE' }).ok, true); // but resigning is still allowed
  const after = act(s, 'p2', { type: 'PLAY', placements: play(3) });
  assert.equal(after.limitedPlayerId, null); // used up
});

test('limit: with fewer than 3 straight/turn cards you must play all of them', () => {
  const p1 = cards('straight', 'limit', 'turn', 'turn', 'turn');
  const p2 = cards('straight', 'turn', 'limit', 'cross', 'cross'); // only two line cards
  let s = rig(newGame(), { p1, p2 });
  s = act(s, 'p1', {
    type: 'PLAY',
    placements: [
      { kind: 'straight', x: 50, y: 50, rot: 0, cardId: p1[0].id },
      { kind: 'limit', cardId: p1[1].id },
    ],
  });
  assert.equal(limitRequirement(s, 'p2'), 2);
  const one = withCards([{ kind: 'straight', x: 51, y: 50, rot: 0 }], s.hands.p2);
  assert.equal(reject(s, 'p2', { type: 'PLAY', placements: one }).ok, false);
  const two = withCards([{ kind: 'straight', x: 51, y: 50, rot: 0 }, { kind: 'turn', x: 52, y: 50, rot: 0 }], s.hands.p2);
  assert.equal(reject(s, 'p2', { type: 'PLAY', placements: two }).ok, true);
});

test('cross: turns a straight into an intersection with four ends', () => {
  const p1 = cards('straight', 'turn', 'turn', 'turn', 'turn');
  const p2 = cards('turn', 'cross', 'straight', 'straight', 'straight');
  let s = rig(newGame(), { p1, p2 });
  s = act(s, 'p1', { type: 'PLAY', placements: [{ kind: 'straight', x: 50, y: 50, rot: 0, cardId: p1[0].id }] });
  assert.equal(openEnds(s.board).length, 2);

  const crossCard = s.hands.p2.find((c) => c.type === 'cross');
  const turnCard = s.hands.p2.find((c) => c.type === 'turn');
  const withTurn = (extra) => [{ kind: 'turn', x: 51, y: 50, rot: 0, cardId: turnCard.id }, ...extra];

  // targets must be straights that are on the board
  assert.equal(reject(s, 'p2', { type: 'PLAY', placements: withTurn([{ kind: 'cross', x: 60, y: 60, cardId: crossCard.id }]) }).ok, false);
  const bad = [{ kind: 'turn', x: 51, y: 50, rot: 0, cardId: turnCard.id }, { kind: 'cross', x: 51, y: 50, cardId: crossCard.id }];
  assert.equal(reject(s, 'p2', { type: 'PLAY', placements: bad }).ok, false); // a turn cannot become a cross

  const after = act(s, 'p2', {
    type: 'PLAY',
    placements: withTurn([{ kind: 'cross', x: 50, y: 50, cardId: crossCard.id }]),
  });
  assert.equal(after.board[cellKey(50, 50)].kind, 'cross');
  assert.equal(after.board[cellKey(50, 50)].owner, 'p1'); // the card stays where it was
  assert.ok(!after.hands.p2.some((c) => c.id === crossCard.id));
});

test('cross can convert a straight placed earlier in the same turn', () => {
  const p1 = cards('straight', 'cross', 'turn', 'turn', 'turn');
  let s = rig(newGame(), { p1 });
  const placements = [
    { kind: 'straight', x: 50, y: 50, rot: 0, cardId: p1[0].id },
    { kind: 'cross', x: 50, y: 50, cardId: p1[1].id },
  ];
  s = act(s, 'p1', { type: 'PLAY', placements });
  assert.equal(s.board[cellKey(50, 50)].kind, 'cross');
});

test('cross and limit do not exist in normal mode', () => {
  const s = rules.setup({ players, options: {}, now: T0, seed: 1 });
  assert.equal(s.hands, undefined);
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [{ kind: 'limit' }] }).ok, false);
  assert.equal(reject(s, 'p1', { type: 'SOLVE' }).ok, false);
});

test('a circuit with an intersection needs all four sides connected', () => {
  // A cross at the center, with two 3-turn loops: one joins its N and E ends, one its S and W ends.
  const board = { [cellKey(50, 50)]: { x: 50, y: 50, kind: 'cross', rot: 0 } };
  const add = (x, y, rot) => (board[cellKey(x, y)] = { x, y, kind: 'turn', rot });
  // N-E loop: (50,49)[E,S]=rot1, (51,49)[S,W]=rot2, (51,50)[W,N]=rot3
  add(50, 49, 1); add(51, 49, 2); add(51, 50, 3);
  assert.equal(isClosed(board), false); // the cross's south and west sides are still open
  assert.equal(openEnds(board).filter((e) => e.x === 50 && e.y === 50).length, 2);
  // S-W loop: (50,51)[W,N]=rot3, (49,51)[N,E]=rot0, (49,50)[E,S]=rot1
  add(50, 51, 3); add(49, 51, 0); add(49, 50, 1);
  assert.equal(isClosed(board), true);
  delete board[cellKey(49, 51)]; // break the loop again
  assert.equal(isClosed(board), false);
});

test('challenge (advanced): the challenged player uses the face-up deck, any number of cards', () => {
  const hand = cards('turn', 'turn', 'turn', 'straight', 'straight');
  const deck = cards('turn', 'straight', 'limit', 'straight');
  let s = rig(newGame(), { p1: hand, deck });
  s = act(s, 'p1', { type: 'PLAY', placements: withCards(SQUARE.slice(0, 3), hand) });
  assert.equal(s.hands.p1.length, 5);
  // the deck was just refilled from; set a known pool for the challenge
  s = rig(s, { deck: cards('turn', 'straight', 'limit', 'straight') });
  s = act(s, 'p2', { type: 'CHALLENGE' });
  assert.equal(s.phase, 'challenge');
  assert.deepEqual(poolCounts(s), { straight: 2, turn: 1 });
  assert.equal(rules.getStatus(s).currentPlayerId, 'p1');

  // cannot use cards the deck does not have
  const twoTurns = [SQUARE[3], { kind: 'turn', x: 52, y: 50, rot: 0 }];
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: twoTurns }).ok, false);
  // function cards cannot be used
  assert.equal(reject(s, 'p1', { type: 'PLAY', placements: [{ kind: 'cross', x: 50, y: 50 }] }).ok, false);

  const won = act(s, 'p1', { type: 'PLAY', placements: [SQUARE[3]] });
  assert.equal(won.result.winnerId, 'p1');
  assert.equal(won.result.reason, 'challenge-success');
});

test('challenge (advanced): failing hands the win to the challenger', () => {
  const hand = cards('straight', 'straight', 'straight', 'straight', 'straight');
  let s = rig(newGame(), { p1: hand });
  s = act(s, 'p1', { type: 'PLAY', placements: [{ kind: 'straight', x: 50, y: 50, rot: 0, cardId: hand[0].id }] });
  s = rig(s, { deck: cards('straight', 'straight', 'straight', 'straight') });
  s = act(s, 'p2', { type: 'CHALLENGE' });
  // more than 3 cards are allowed in a challenge, they just do not close the circuit
  const many = [51, 52, 53, 54].map((x) => ({ kind: 'straight', x, y: 50, rot: 0 }));
  const lost = act(s, 'p1', { type: 'PLAY', placements: many });
  assert.equal(lost.result.winnerId, 'p2');
  assert.equal(lost.result.reason, 'challenge-failed');
});

test('solve unlocks at 22 cards in the deck, and wins or loses the game', () => {
  const hand = cards('turn', 'turn', 'turn', 'turn', 'turn');
  let s = rig(newGame(), { p1: hand });
  s = act(s, 'p1', { type: 'PLAY', placements: withCards(SQUARE.slice(0, 3), hand) });

  // p2 to move; the deck is still big, so solve is not available
  assert.equal(reject(s, 'p2', { type: 'SOLVE' }).ok, false);

  const late = rig(s, { deck: cards('turn', ...Array(21).fill('limit')) });
  assert.equal(late.deckRemaining, 22);
  assert.equal(reject(late, 'p2', { type: 'SOLVE' }).ok, true);
  assert.equal(reject(late, 'p1', { type: 'SOLVE' }).ok, false); // not their turn

  const solving = act(late, 'p2', { type: 'SOLVE' });
  assert.equal(solving.phase, 'solve');
  assert.equal(rules.getStatus(solving).currentPlayerId, 'p2'); // the solver acts
  assert.equal(solving.deadline - solving.turnStartedAt, (30 + 30) * 1000);

  const win = act(solving, 'p2', { type: 'PLAY', placements: [SQUARE[3]] });
  assert.equal(win.result.winnerId, 'p2');
  assert.equal(win.result.reason, 'solve-success');

  // failing to solve loses
  const lose = act(solving, 'p2', { type: 'PLAY', placements: [{ kind: 'turn', x: 52, y: 50, rot: 0 }] });
  assert.equal(lose.result.winnerId, 'p1');
  assert.equal(lose.result.reason, 'solve-failed');

  // giving up and running out of time lose as well
  assert.equal(act(solving, 'p2', { type: 'CONCEDE' }).result.winnerId, 'p1');
  const timedOut = act(solving, 'p2', { type: 'TIMEOUT' }, { now: solving.deadline });
  assert.equal(timedOut.result.winnerId, 'p1');
  assert.equal(timedOut.result.reason, 'solve-timeout');
});

test('deck out: players play their remaining hands, then it is a draw', () => {
  const p1 = cards('straight', 'straight');
  const p2 = cards('straight');
  let s = rig(newGame(), { p1, p2, deck: [] });

  s = act(s, 'p1', { type: 'PLAY', placements: [{ kind: 'straight', x: 50, y: 50, rot: 0, cardId: p1[0].id }] });
  assert.equal(s.hands.p1.length, 1); // no refill, the deck is empty
  assert.equal(s.phase, 'play');

  s = act(s, 'p2', { type: 'PLAY', placements: [{ kind: 'straight', x: 51, y: 50, rot: 0, cardId: p2[0].id }] });
  assert.equal(s.phase, 'play'); // p1 still holds a card
  assert.equal(rules.getStatus(s).currentPlayerId, 'p1');

  s = act(s, 'p1', { type: 'PLAY', placements: [{ kind: 'straight', x: 52, y: 50, rot: 0, cardId: p1[1].id }] });
  assert.equal(s.phase, 'over');
  assert.equal(s.result.winnerId, null);
  assert.equal(s.result.reason, 'no-cards');
  assert.equal(s.draws, 1);
});

test('a player with nothing to play is skipped while the other still can', () => {
  const p1 = cards('straight', 'straight', 'straight');
  const p2 = cards('limit', 'cross');
  let s = rig(newGame(), { p1, p2, deck: [] });
  s = act(s, 'p1', { type: 'PLAY', placements: [{ kind: 'straight', x: 50, y: 50, rot: 0, cardId: p1[0].id }] });
  assert.equal(rules.getStatus(s).currentPlayerId, 'p1'); // p2 cannot play, so p1 goes again
  assert.match(s.notice, /skips/);
});

test('next game reshuffles with the new seed and swaps the starter', () => {
  const hand = cards('turn', 'turn', 'turn', 'turn', 'turn');
  let s = rig(newGame(), { p1: hand });
  s = act(s, 'p1', { type: 'PLAY', placements: withCards(SQUARE.slice(0, 3), hand) });
  s = act(s, 'p2', { type: 'CHALLENGE' });
  s = act(s, 'p1', { type: 'CONCEDE' });
  assert.equal(s.phase, 'over');

  const a = act(s, 'p1', { type: 'NEXT_GAME' }, { seed: 5 });
  const b = act(s, 'p1', { type: 'NEXT_GAME' }, { seed: 6 });
  assert.equal(a.gameNumber, 2);
  assert.equal(a.deckTotal, 80);
  assert.equal(a.hands.p1.length, 5);
  assert.equal(rules.getStatus(a).currentPlayerId, 'p2');
  assert.notEqual(JSON.stringify(a.hands), JSON.stringify(b.hands));
  assert.deepEqual(a.board, {});
});

test('advanced reduce never mutates the previous state and is deterministic', () => {
  const hand = cards('straight', 'turn', 'turn', 'turn', 'turn');
  const s = rig(newGame(), { p1: hand });
  const snapshot = JSON.stringify(s);
  const action = { type: 'PLAY', placements: [{ kind: 'straight', x: 50, y: 50, rot: 0, cardId: hand[0].id }] };
  const a = act(s, 'p1', action);
  const b = act(s, 'p1', action);
  assert.equal(JSON.stringify(s), snapshot);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
