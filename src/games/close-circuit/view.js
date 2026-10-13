import './styles.css';
import { el } from '../../core/dom.js';
import { rules, placementProblem, centerCell, poolCounts, ADVANCED } from './rules.js';
import { CARD_KINDS, E, S, cellKey, openEnds, isWinningBoard, pieceEnds } from './circuit.js';

/** Hand card names and tooltips (advanced mode). */
const CARD_INFO = {
  straight: { name: 'Straight', tip: 'Straight line' },
  turn: { name: 'Turn', tip: '90° turn' },
  cross: {
    name: 'Cross',
    tip: 'Turns a straight line that is already on the board into an intersection (+); all four sides of it must connect. Tap this card, then tap a straight line on the board.',
  },
  limit: {
    name: 'Limit',
    tip: 'Your opponent must play 3 straight/turn cards on their next turn, or all of them if they hold fewer than 3. Tap it to use it this turn, tap again to take it back.',
  },
};
const HAND_ORDER = ['straight', 'turn', 'cross', 'limit'];
const isLineType = (type) => type === 'straight' || type === 'turn';

/**
 * SVG preview of a card in a given rotation, drawn from the same line ends the board uses,
 * so the button always shows exactly what will be placed. 24x24 cell, ends at the edge midpoints.
 */
function cardIcon(kind, rot) {
  const mid = [[12, 0], [24, 12], [12, 24], [0, 12]]; // N, E, S, W
  let path;
  if (kind === 'cross') {
    path = 'M12 0V24M0 12H24';
  } else if (kind === 'straight') {
    const [a, b] = pieceEnds(kind, rot);
    path = `M${mid[a][0]} ${mid[a][1]}L${mid[b][0]} ${mid[b][1]}`;
  } else {
    const [a, b] = pieceEnds(kind, rot);
    const [ax, ay] = mid[a];
    const [bx, by] = mid[b];
    // Quarter circle around the cell corner shared by both ends
    const cornerX = a === E || b === E ? 24 : 0;
    const cornerY = a === S || b === S ? 24 : 0;
    let d = Math.atan2(by - cornerY, bx - cornerX) - Math.atan2(ay - cornerY, ax - cornerX);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    path = `M${ax} ${ay}A12 12 0 0 ${d < 0 ? 0 : 1} ${bx} ${by}`;
  }
  return (
    '<svg viewBox="0 0 24 24" width="30" height="30" fill="none">' +
    '<rect x="0.75" y="0.75" width="22.5" height="22.5" rx="5" fill="#fff6e0" stroke="#b08457" stroke-width="1.5"/>' +
    `<path d="${path}" stroke="#3f8fe0" stroke-width="4.5"/>` +
    '</svg>'
  );
}

const MIN_SIZE = 5; // zoom limits, in pixels per cell (5 lets a phone show a big chunk of the 100x100 grid)
const MAX_SIZE = 96;
const DEFAULT_SIZE = 56;
const FIT_MARGIN = 2; // empty tiles kept around the played cards by the "Fit" button

/**
 * Close Circuit view: renders the state on a canvas and turns clicks into actions.
 * A turn is drafted locally (pieces placed but not yet submitted) and sent to the
 * authority as ONE atomic PLAY action. The view never changes game state itself.
 *
 * @type {import('../../core/types.js').GameModule['mount']}
 */
export function mount(container, api) {
  const players = api.players;
  const colors = { [players[0].id]: '#3f8fe0', [players[1].id]: '#e8607f' };
  // Each player has their own team of cute animals riding on their cards. The animal on a
  // card is picked from its cell, so it stays the same on every redraw (pure decoration).
  const teams = {
    [players[0].id]: ['🐱', '🐻', '🐼', '🐨', '🐥', '🐰'],
    [players[1].id]: ['🐶', '🦊', '🐷', '🐸', '🐯', '🐵'],
  };
  const animalFor = (piece, ownerId) => {
    const team = teams[ownerId] ?? teams[players[0].id];
    return team[Math.abs(piece.x * 31 + piece.y * 17) % team.length];
  };

  // ---- View-local state (not game state) ----
  let state = null;
  // Cards used this turn but not submitted yet. Normal mode and challenge/solve: {x,y,kind,rot}.
  // Advanced hand play: the same plus `cardId`, a cross is {x,y,kind:'cross',cardId}, a limit {kind:'limit',cardId}.
  let draft = [];
  let selectedCardId = null; // advanced: the hand card that the next tap on the board will place
  let revealedKey = null; // pass-and-play: the turn whose hand was uncovered
  let kind = 'straight';
  // Each card type remembers its own rotation, so rotating one never changes the other.
  const rots = { straight: 0, turn: 0 };
  const currentRot = () => rots[kind];
  // Advanced mode: every hand card has its own rotation, so Rotate only turns the selected card.
  let cardRots = {}; // cardId -> rotation
  const rotOf = (card) => cardRots[card.id] ?? 0;
  let hover = null; // { x, y } cell under the pointer
  let showOpenEnds = true;
  let timeoutSentFor = null;
  let drawQueued = false;
  let dragging = null;
  let cssW = 0;
  let cssH = 0;
  const cam = { size: DEFAULT_SIZE, cx: 50.5, cy: 50.5 }; // cx, cy = world point (in cells) at the canvas center

  // ---- DOM ----
  const playerEls = players.map((p) => {
    const wins = el('div', { class: 'cc__wins' }, '0');
    const name = el('div', { class: 'cc__pname' }, p.name);
    const node = el(
      'div',
      { class: 'cc__player', style: { '--pc': colors[p.id] } },
      el('span', { class: 'cc__dot' }),
      el('div', {}, name, el('div', { class: 'muted' }, 'wins')),
      wins,
    );
    return { node, wins, name };
  });

  const timerFill = el('div', { class: 'cc__timer-fill' });
  const timerText = el('div', { class: 'cc__timer-text' }, '–');
  const timerEl = el('div', { class: 'cc__timer' }, timerFill, timerText);
  const gameInfo = el('div', { class: 'muted cc__info' });
  const centerHud = el('div', { class: 'cc__center' }, gameInfo, timerEl);

  const banner = el('div', { class: 'cc__banner' });
  const notice = el('div', { class: 'cc__notice' });
  const hint = el('div', { class: 'cc__hint muted' });

  // Advanced mode: the other player's hand as card backs (you see how many function cards they
  // hold, never which), and your own hand face up.
  const oppLabel = el('span', { class: 'cc__hlabel' });
  const oppBacks = el('span', { class: 'cc__backs' });
  const oppRow = el('div', { class: 'cc__opp' }, oppLabel, oppBacks);
  oppRow.hidden = true;

  const canvas = el('canvas', { class: 'cc__canvas' });
  // On-screen zoom buttons: they work everywhere, even where pinch gestures are unreliable.
  const zoomButton = (label, title, onclick) =>
    el('button', { class: 'btn btn--ghost cc__zbtn', title, 'aria-label': title, onclick }, label);
  const zoomBar = el(
    'div',
    { class: 'cc__zoom' },
    zoomButton('−', 'Zoom out', () => zoomBy(1 / 1.4)),
    zoomButton('+', 'Zoom in', () => zoomBy(1.4)),
    zoomButton('Fit', 'Zoom in to show all played cards plus a 2-tile border', () => { recenter(); scheduleDraw(); }),
  );
  const boardWrap = el('div', { class: 'cc__board' }, canvas, zoomBar);

  // The icons are redrawn in refresh() so they follow the current rotation.
  const straightIcon = el('span', { class: 'cc__icon' });
  const turnIcon = el('span', { class: 'cc__icon' });
  // In a face-up challenge or solve these also show how many of each card are left in the deck.
  const straightLeft = el('span', { class: 'cc__left' });
  const turnLeft = el('span', { class: 'cc__left' });
  const straightBtn = el('button', { class: 'cc__kind', title: 'Straight line (T)', onclick: () => setKind('straight') }, straightIcon, el('span', {}, 'Straight'), straightLeft);
  const turnBtn = el('button', { class: 'cc__kind', title: 'Turning line (T)', onclick: () => setKind('turn') }, turnIcon, el('span', {}, 'Turn'), turnLeft);
  const kindGroup = el('div', { class: 'cc__kinds' }, straightBtn, turnBtn);
  const poolNote = el('div', { class: 'cc__poolnote muted' });

  // Your hand (advanced). Rebuilt on every refresh.
  const handLabel = el('span', { class: 'cc__hlabel' });
  const handCards = el('div', { class: 'cc__hand' });
  // Explains a function card. Shown while hovering it (mouse) and after tapping it (phones can't hover).
  const handHelp = el('div', { class: 'cc__help' });
  handHelp.hidden = true;
  let pinnedHelp = null; // function card type last tapped
  let hoverHelp = null; // function card type under the mouse
  function renderHelp() {
    const type = hoverHelp ?? pinnedHelp;
    handHelp.hidden = !type;
    if (type) handHelp.replaceChildren(el('b', {}, `${CARD_INFO[type].name}: `), CARD_INFO[type].tip);
  }
  const handPanel = el('div', { class: 'cc__handpanel' }, handLabel, handCards, handHelp);
  handPanel.hidden = true;
  const rotateBtn = el('button', { class: 'btn btn--ghost', title: 'Rotate (R or right-click)', onclick: rotate }, '⟳ Rotate');
  const countEl = el('div', { class: 'cc__count muted' });
  const undoBtn = el('button', { class: 'btn btn--ghost', title: 'Undo last card (Z)', onclick: undo }, 'Undo');
  const endBtn = el('button', { class: 'btn', onclick: submit }, 'End turn');
  const challengeBtn = confirmButton('No solution! (challenge)', 'Click again to challenge', () => api.dispatch({ type: 'CHALLENGE' }));
  const solveBtn = confirmButton('Solve!', 'Click again to solve', () => api.dispatch({ type: 'SOLVE' }));
  solveBtn.node.hidden = true;
  const resignBtn = confirmButton('Resign', 'Click again to resign', () => api.dispatch({ type: 'CONCEDE' }));
  const openEndsToggle = el('input', { type: 'checkbox', checked: true, onchange: (e) => { showOpenEnds = e.target.checked; scheduleDraw(); } });

  const controls = el(
    'div',
    { class: 'cc__controls' },
    handPanel,
    el('div', { class: 'cc__group' }, kindGroup, rotateBtn),
    poolNote,
    el('div', { class: 'cc__group' }, countEl, undoBtn, endBtn),
    el('div', { class: 'cc__group' }, challengeBtn.node, solveBtn.node, resignBtn.node),
    el('label', { class: 'cc__toggle muted' }, openEndsToggle, 'Show open ends'),
  );

  const resultMsg = el('div', { class: 'cc__result-msg' });
  const nextBtn = el('button', { class: 'btn', onclick: () => api.dispatch({ type: 'NEXT_GAME' }) }, 'Next game');
  const result = el(
    'div',
    { class: 'cc__result' },
    resultMsg,
    el('div', { class: 'row-actions' }, nextBtn, el('button', { class: 'btn btn--ghost', onclick: api.exit }, 'Back to lobby')),
  );

  // The rules text depends on the mode, so it is filled in once the first state arrives.
  const howList = el('ul', {});
  const howTo = el('details', { class: 'cc__how' }, el('summary', {}, 'How to play'), howList);
  const CONTROLS_TEXT =
    'Controls: click or tap a cell to place · Rotate button (R or right-click) turns the selected card · T switches straight/turn · Z undoes · drag to pan · scroll wheel, pinch or the − / + buttons to zoom · Fit zooms in as far as possible while still showing every card plus a 2-tile border. Red dots mark open line ends.';
  function fillHowTo(advanced) {
    const lines = advanced
      ? [
          'Advanced mode: the deck has 48 straight and 24 turn cards plus 4 Limit and 4 Cross function cards, shuffled. Each player holds 5 cards and refills to 5 after every turn until the deck runs out.',
          'On your turn play 1 to 3 cards from your hand (function cards count too, and at least one must be a straight or turn). Tap a card, then tap a cell next to the board. The first card goes in the center. Then press End turn.',
          'Limit: your opponent must play 3 straight/turn cards next turn (or all they have if fewer). Cross: turns a straight line already on the board into an intersection (+); all four sides must connect. Hover over or tap a function card to see what it does.',
          'The card backs above the board show how many cards the other player holds. Function cards have a gift-box back, so you can see how many they have, but not which.',
          'If your hand has no straight or turn card, it is shuffled back and you draw 5 again.',
          'Close the circuit to win: every line end must connect, nothing sticking out. Instead of playing you can say "No solution!". The other player then sees the cards left in the deck and may pick any of them to close the circuit. If they do they win, otherwise you do.',
          `Once ${ADVANCED.solveAtDeck} or fewer cards are left in the deck either player can say "Solve!" on their turn: they must close the circuit with the cards left in the deck, or they lose.`,
          'When the deck runs out you play the cards left in your hands. If nobody can play any more it is a draw.',
          'Run out of time and you lose the game. Player 1 starts the first game, player 2 the next, and so on.',
        ]
      : [
          'Both players share one deck of 48 line cards. Each card can be placed as a straight line or a 90° turn.',
          'On your turn place 1 to 3 cards. The very first card goes in the center. After that cards can go anywhere, they do not have to touch the board. But the cards you place in one turn must be next to each other in a straight line (any mix of straights and turns). An L shape is not allowed. Then press End turn.',
          'Close the circuit to win: every line end on the board must connect to another, with nothing sticking out, and every card on the board must belong to the same single circuit. A square or rectangle works; a single line, or two separate loops, does not.',
          'Instead of placing cards you can challenge with "No solution!". The other player then gets extra time and may use all the cards left in the deck, in any shape, to close the circuit. If they manage it they win, otherwise you do.',
          'When the deck runs out the game is a draw unless the circuit is closed.',
          'Run out of time and you lose the game. Player 1 starts the first game, player 2 the next, and so on.',
        ];
    howList.replaceChildren(...[...lines, CONTROLS_TEXT].map((t) => el('li', {}, t)));
  }

  const root = el(
    'div',
    { class: 'cc' },
    el('div', { class: 'cc__hud' }, playerEls[0].node, centerHud, playerEls[1].node),
    banner,
    notice,
    oppRow,
    boardWrap,
    hint,
    controls,
    result,
    howTo,
  );
  container.append(root);

  // ---- Helpers ----
  const actorId = () => (state && state.phase !== 'over' ? state.players[state.current].id : null);
  const isAdvanced = () => state?.options.mode === 'advanced';
  /** Challenge or solve in advanced mode: the face-up deck, not a hand, supplies the cards. */
  const inPool = () => isAdvanced() && (state.phase === 'challenge' || state.phase === 'solve');
  /** Advanced mode, normal turn: cards come from the player's hand. */
  const inHandPlay = () => isAdvanced() && state.phase === 'play';
  const maxDraft = () => {
    if (!state) return 0;
    if (inPool()) return Infinity; // limited by the cards left in the deck instead
    if (inHandPlay()) return ADVANCED.maxCards;
    if (state.phase === 'challenge') return state.deckRemaining; // a challenged player may use the whole deck
    return Math.min(state.options.maxPerTurn, state.deckRemaining);
  };
  const turnKey = () => (state ? `${state.gameNumber}:${state.turnNumber}:${state.phase}` : null);
  const boardIsEmpty = () => Object.keys(state.board).length === 0;
  const hasPosition = (p) => Number.isInteger(p.x) && Number.isInteger(p.y);

  /** Whose hand is shown face up: the player on the move (pass-and-play) or this device's player (online). */
  const handOwnerId = () => (api.mode === 'online' ? api.localPlayerId : actorId());
  /** Pass-and-play shares one screen, so each turn starts with the hand covered. */
  const handCovered = () => api.mode !== 'online' && revealedKey !== turnKey();

  const usedCardIds = () => new Set(draft.map((d) => d.cardId));
  const myHand = () => (inHandPlay() ? state.hands[actorId()] ?? [] : []);
  const unusedCards = (type) => myHand().filter((c) => c.type === type && !usedCardIds().has(c.id));
  const selectedCard = () => myHand().find((c) => c.id === selectedCardId && !usedCardIds().has(c.id)) ?? null;

  /** Cards left in the deck (challenge/solve) minus the ones in the current draft. */
  function poolLeft() {
    const left = poolCounts(state);
    for (const d of draft) if (d.kind in left) left[d.kind] -= 1;
    return left;
  }

  function mergedBoard() {
    const merged = { ...state.board };
    for (const p of draft) {
      if (p.kind === 'limit') continue;
      const key = cellKey(p.x, p.y);
      merged[key] = p.kind === 'cross' ? { ...merged[key], kind: 'cross', rot: 0 } : { ...p, owner: actorId() };
    }
    return merged;
  }

  /** The card that a tap on cell (x, y) would place right now, or a reason why nothing can be placed. */
  function itemAt(x, y) {
    if (inHandPlay()) {
      const card = selectedCard();
      if (!card) return { problem: handCovered() ? 'Show your cards first' : 'Pick a card from your hand first' };
      if (card.type === 'cross') return { item: { x, y, kind: 'cross', cardId: card.id } };
      if (card.type === 'limit') return { problem: 'The Limit card has no cell: tap it again to use or remove it' };
      return { item: { x, y, kind: card.type, rot: rotOf(card), cardId: card.id } };
    }
    if (inPool() && poolLeft()[kind] <= 0) return { problem: `No ${kind} cards left in the deck` };
    return { item: { x, y, kind, rot: currentRot() } };
  }
  /** Why a tap on (x, y) cannot place anything (null if it can). */
  function problemAt(x, y) {
    const { item, problem } = itemAt(x, y);
    return problem ?? placementProblem(state, draft, item);
  }

  function confirmButton(label, armedLabel, onConfirm) {
    let timer = null;
    const node = el('button', { class: 'btn btn--ghost' }, label);
    const disarm = () => {
      clearTimeout(timer);
      node.textContent = label;
      node.classList.remove('is-armed');
    };
    node.addEventListener('click', () => {
      if (node.classList.contains('is-armed')) {
        disarm();
        onConfirm();
      } else {
        node.classList.add('is-armed');
        node.textContent = armedLabel;
        timer = setTimeout(disarm, 4000);
      }
    });
    return { node, disarm };
  }

  // ---- Card controls ----
  function setKind(next) {
    kind = next;
    if (inHandPlay()) {
      // In advanced play the type buttons and the T key pick a card of that type from the hand
      const card = unusedCards(next)[0];
      if (card) selectedCardId = card.id;
    }
    refresh();
  }

  /** Advanced: tap a hand card. Line and cross cards get selected, a Limit card is toggled on or off. */
  function pickCard(card) {
    // Tapping a function card explains it; tapping a line card clears the explanation
    pinnedHelp = isLineType(card.type) ? null : card.type;
    if (card.type === 'limit') {
      const at = draft.findIndex((d) => d.cardId === card.id);
      if (at >= 0) draft.splice(at, 1);
      else if (draft.length < maxDraft()) draft.push({ kind: 'limit', cardId: card.id });
    } else {
      selectedCardId = card.id;
      if (isLineType(card.type)) kind = card.type;
    }
    refresh();
  }
  function rotate() {
    if (inHandPlay()) {
      // Advanced hand play: only the selected card turns, never any other card of the same type
      const card = selectedCard();
      if (card && isLineType(card.type)) {
        cardRots[card.id] = (rotOf(card) + 1) % CARD_KINDS[card.type].rotations;
        refresh();
      }
      return;
    }
    // Normal mode and face-up deck: only the selected card type turns; the other one stays as it was
    rots[kind] = (rots[kind] + 1) % CARD_KINDS[kind].rotations;
    refresh();
  }
  function undo() {
    if (!draft.length) return;
    const undone = draft.pop(); // only the last card can be removed, so every card still touches the board
    if (undone.cardId && undone.kind !== 'limit') selectedCardId = undone.cardId;
    refresh();
  }
  function showError(message) {
    hint.textContent = message;
    hint.classList.remove('is-good');
    hint.classList.add('is-error');
  }
  function submit() {
    if (!state || state.phase === 'over' || !draft.length) return;
    const action = { type: 'PLAY', placements: draft.map((d) => ({ ...d })) };
    // Check first, so a broken turn (for example a Limit that needs 3 cards) explains itself.
    const verdict = rules.validate(state, action, actorId(), { now: Date.now() });
    if (!verdict.ok) {
      showError(verdict.error);
      return;
    }
    api.dispatch(action);
    draft = [];
    selectedCardId = null;
    refresh();
  }

  function placeAt(x, y) {
    if (!state || state.phase === 'over' || draft.length >= maxDraft()) return;
    const { item, problem: early } = itemAt(x, y);
    const problem = early ?? placementProblem(state, draft, item);
    if (problem) {
      showError(problem);
      return;
    }
    draft.push(item);
    if (item.cardId) {
      // Move on to another card of the same type, if the hand has one
      selectedCardId = unusedCards(item.kind)[0]?.id ?? null;
    }
    refresh();
  }

  // ---- Camera ----
  const toScreen = (wx, wy) => [(wx - cam.cx) * cam.size + cssW / 2, (wy - cam.cy) * cam.size + cssH / 2];
  const toCell = (px, py) => [
    Math.floor((px - cssW / 2) / cam.size + cam.cx),
    Math.floor((py - cssH / 2) / cam.size + cam.cy),
  ];

  /** Zoom around the middle of the view. */
  function zoomBy(factor) {
    cam.size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, cam.size * factor));
    scheduleDraw();
  }

  function recenter() {
    const pieces = state ? [...Object.values(state.board), ...draft.filter(hasPosition)] : [];
    if (!pieces.length) {
      const c = state ? centerCell(state.options.gridSize) : 50;
      cam.cx = cam.cy = c + 0.5;
      cam.size = DEFAULT_SIZE;
      return;
    }
    const xs = pieces.map((p) => p.x);
    const ys = pieces.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    cam.cx = (minX + maxX + 1) / 2;
    cam.cy = (minY + maxY + 1) / 2;
    // Zoom in as far as possible while every card (including this turn's draft) stays visible
    // with FIT_MARGIN empty tiles on each side. The tighter axis decides the zoom level.
    const fit = Math.min(cssW / (maxX - minX + 1 + 2 * FIT_MARGIN), cssH / (maxY - minY + 1 + 2 * FIT_MARGIN));
    cam.size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, fit || DEFAULT_SIZE));
  }

  // ---- Drawing ----
  function scheduleDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(draw);
  }

  function resizeCanvas() {
    const rect = boardWrap.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scheduleDraw();
  }

  function edgeMid(sx, sy, s, dir) {
    return [
      [sx + s / 2, sy],
      [sx + s, sy + s / 2],
      [sx + s / 2, sy + s],
      [sx, sy + s / 2],
    ][dir];
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Draw one card: a cream tile with a colored track (straight line or quarter-circle turn)
   * between its two ends, and a cute animal on a round badge (on the track for straights,
   in the open part of the tile for turns so the curve stays visible).
   */
  function drawPiece(ctx, piece, color, { alpha = 1, dashed = false, glow = false, owner = piece.owner } = {}) {
    const s = cam.size;
    const [sx, sy] = toScreen(piece.x, piece.y);
    if (sx > cssW || sy > cssH || sx + s < 0 || sy + s < 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // The tile: soft cream with a little shadow, like a wooden game piece
    const pad = Math.max(1, s * 0.03);
    ctx.shadowColor = 'rgba(70, 35, 8, 0.35)';
    ctx.shadowBlur = s * 0.1;
    ctx.shadowOffsetY = s * 0.04;
    roundedRect(ctx, sx + pad, sy + pad, s - 2 * pad, s - 2 * pad, s * 0.2);
    ctx.fillStyle = '#fff6e0';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = glow ? Math.max(2.5, s * 0.06) : Math.max(1.5, s * 0.035);
    ctx.strokeStyle = dashed ? color : glow ? '#f2b01e' : 'rgba(150, 100, 50, 0.55)';
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    // The track (runs to the cell edges so neighbouring cards connect seamlessly)
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, s * 0.2);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    const [a, b] = pieceEnds(piece.kind, piece.rot);
    const [ax, ay] = edgeMid(sx, sy, s, a);
    const [bx, by] = edgeMid(sx, sy, s, b);
    let mx = sx + s / 2; // where the animal sits (middle of the track for straight cards)
    let my = sy + s / 2;
    if (piece.kind === 'cross') {
      // An intersection: four tracks from the middle out to every edge
      for (let dir = 0; dir < 4; dir++) {
        const [ex, ey] = edgeMid(sx, sy, s, dir);
        ctx.moveTo(mx, my);
        ctx.lineTo(ex, ey);
      }
    } else if (piece.kind === 'straight') {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    } else {
      // The arc is centered on the cell corner shared by the two ends.
      const cornerX = a === E || b === E ? sx + s : sx;
      const cornerY = a === S || b === S ? sy + s : sy;
      const a1 = Math.atan2(ay - cornerY, ax - cornerX);
      const a2 = Math.atan2(by - cornerY, bx - cornerX);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      ctx.arc(cornerX, cornerY, s / 2, a1, a2, d < 0);
      // The curve hugs its corner, so the animal sits in the open part of the tile instead,
      // out of the way of the curve.
      mx = cornerX + (cornerX === sx ? 1 : -1) * s * 0.66;
      my = cornerY + (cornerY === sy ? 1 : -1) * s * 0.66;
    }
    ctx.stroke();
    // Soft highlight along the track
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = Math.max(1, s * 0.07);
    ctx.stroke();

    // The animal, on a little round badge (skipped when zoomed far out: too small to see)
    if (s >= 22) {
      ctx.beginPath();
      ctx.arc(mx, my, s * (piece.kind === 'straight' ? 0.27 : 0.22), 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf6';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, s * 0.04);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.font = `${Math.round(s * (piece.kind === 'straight' ? 0.36 : 0.3))}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000000';
      ctx.fillText(animalFor(piece, owner), mx, my + s * 0.02);
    }
    ctx.restore();
  }

  function draw() {
    drawQueued = false;
    if (!state) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Table around the board: darker wood
    const table = ctx.createLinearGradient(0, 0, cssW, cssH);
    table.addColorStop(0, '#c49662');
    table.addColorStop(1, '#a8794a');
    ctx.fillStyle = table;
    ctx.fillRect(0, 0, cssW, cssH);

    const g = state.options.gridSize;
    const s = cam.size;
    const [gx, gy] = toScreen(0, 0);

    // Grid area and lines (clipped to the playable grid)
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, gy, g * s, g * s);
    ctx.clip();
    // Playing surface: smooth light wood (like a xiangqi board) with a soft sheen
    const wood = ctx.createLinearGradient(0, 0, cssW, cssH);
    wood.addColorStop(0, '#f0d6a6');
    wood.addColorStop(0.5, '#e8c78f');
    wood.addColorStop(1, '#dcb578');
    ctx.fillStyle = wood;
    ctx.fillRect(gx, gy, g * s, g * s);
    const sheen = ctx.createRadialGradient(cssW * 0.3, cssH * 0.2, 0, cssW * 0.3, cssH * 0.2, Math.max(cssW, cssH) * 0.8);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(gx, gy, g * s, g * s);

    const [vx0, vy0] = toCell(0, 0);
    const [vx1, vy1] = toCell(cssW, cssH);
    ctx.strokeStyle = 'rgba(105, 60, 25, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.max(0, vx0); x <= Math.min(g, vx1 + 1); x++) {
      const px = Math.round(toScreen(x, 0)[0]) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cssH);
    }
    for (let y = Math.max(0, vy0); y <= Math.min(g, vy1 + 1); y++) {
      const py = Math.round(toScreen(0, y)[1]) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(cssW, py);
    }
    ctx.stroke();

    // The start cell is highlighted until the first card is down
    if (boardIsEmpty() && !draft.length && state.phase !== 'over') {
      const c = centerCell(g);
      const [cx, cy] = toScreen(c, c);
      ctx.fillStyle = 'rgba(255, 246, 215, 0.6)';
      ctx.fillRect(cx, cy, s, s);
      ctx.strokeStyle = '#b4691f';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(cx + 1.5, cy + 1.5, s - 3, s - 3);
    }
    ctx.restore();

    // Board frame: a thick outer line and a thin inner line, like a xiangqi board
    ctx.strokeStyle = '#6e4120';
    ctx.lineWidth = 4;
    ctx.strokeRect(gx, gy, g * s, g * s);
    ctx.strokeStyle = 'rgba(110, 65, 32, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(gx + 6, gy + 6, g * s - 12, g * s - 12);

    // Cards on the board (green once the circuit is closed)
    const won = state.phase === 'over' && isWinningBoard(state.board, state.options);
    const recent = new Set(state.lastPlaced);
    for (const [key, piece] of Object.entries(state.board)) {
      drawPiece(ctx, piece, won ? '#2fa57a' : colors[piece.owner], { glow: recent.has(key) && state.phase !== 'over' });
    }

    const active = state.phase !== 'over';
    const meId = actorId();
    const me = colors[meId] ?? '#3f8fe0';

    // Cards drafted this turn
    for (const piece of draft) {
      if (piece.kind === 'limit') continue;
      drawPiece(ctx, { ...piece, rot: piece.rot ?? 0 }, me, { alpha: 0.9, dashed: true, owner: piece.kind === 'cross' ? state.board[cellKey(piece.x, piece.y)]?.owner ?? meId : meId });
    }

    // Ghost under the pointer
    if (active && hover && draft.length < maxDraft()) {
      const { item: candidate } = itemAt(hover.x, hover.y);
      const problem = candidate ? placementProblem(state, draft, candidate) : 'no card';
      if (!problem) {
        drawPiece(ctx, { ...candidate, rot: candidate.rot ?? 0 }, me, { alpha: 0.5, owner: meId });
      } else if (candidate && hover.x >= 0 && hover.y >= 0 && hover.x < g && hover.y < g) {
        const [hx, hy] = toScreen(hover.x, hover.y);
        ctx.fillStyle = 'rgba(210, 50, 50, 0.22)';
        ctx.fillRect(hx, hy, s, s);
      }
    }

    // Open ends: line ends that do not connect to anything
    if (showOpenEnds) {
      ctx.fillStyle = '#e5484d';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      for (const end of openEnds(mergedBoard())) {
        const [sx, sy] = toScreen(end.x, end.y);
        const [ex, ey] = edgeMid(sx, sy, s, end.dir);
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(3, s * 0.08), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // ---- UI refresh ----
  function refresh() {
    if (!state) return;
    const active = state.phase !== 'over';
    const challenge = state.phase === 'challenge';
    const status = rules.getStatus(state);

    playerEls.forEach(({ node, wins }, i) => {
      wins.textContent = state.wins[players[i].id];
      node.classList.toggle('is-active', players[i].id === status.currentPlayerId);
    });
    const advanced = isAdvanced();
    const handPlay = active && inHandPlay();
    const pool = active && inPool();
    root.classList.toggle('cc--advanced', advanced);
    gameInfo.textContent = `Game ${state.gameNumber} · ${state.deckRemaining} of ${state.deckTotal} cards left${state.draws ? ` · ${state.draws} draw${state.draws > 1 ? 's' : ''}` : ''}`;

    banner.textContent = status.message;
    notice.textContent = state.notice ?? '';
    notice.hidden = !state.notice || !active;
    renderHands(active, handPlay);
    banner.classList.toggle('is-challenge', challenge);
    banner.classList.toggle('is-over', !active);
    banner.style.setProperty('--pc', colors[status.currentPlayerId] ?? 'var(--primary)');

    straightBtn.classList.toggle('is-selected', kind === 'straight');
    turnBtn.classList.toggle('is-selected', kind === 'turn');
    // Each button shows that card type's own current rotation
    straightIcon.innerHTML = cardIcon('straight', rots.straight);
    turnIcon.innerHTML = cardIcon('turn', rots.turn);

    // Advanced hand play picks cards from the hand; challenge/solve picks from the face-up deck
    kindGroup.hidden = handPlay;
    poolNote.hidden = !pool;
    straightLeft.hidden = turnLeft.hidden = !pool;
    if (pool) {
      const left = poolLeft();
      straightLeft.textContent = `×${left.straight}`;
      turnLeft.textContent = `×${left.turn}`;
      straightBtn.disabled = left.straight <= 0;
      turnBtn.disabled = left.turn <= 0;
      poolNote.textContent = `Cards left in the deck: ${left.straight} straight, ${left.turn} turn. Pick any of them, as many as you need.`;
    } else {
      straightBtn.disabled = turnBtn.disabled = false;
    }
    rotateBtn.hidden = handPlay && selectedCard()?.type !== 'straight' && selectedCard()?.type !== 'turn';

    const max = maxDraft();
    countEl.textContent = !active ? '' : max === Infinity ? `Cards used: ${draft.length}` : `Cards this turn: ${draft.length} / ${max}`;
    endBtn.textContent = challenge || pool ? 'Submit solution' : 'End turn';
    endBtn.disabled = !active || !draft.length;
    undoBtn.disabled = !draft.length;
    const can = (type) => active && !draft.length && rules.validate(state, { type }, actorId(), { now: Date.now() }).ok;
    challengeBtn.node.disabled = !can('CHALLENGE');
    solveBtn.node.hidden = !advanced;
    solveBtn.node.disabled = !can('SOLVE');
    solveBtn.node.title =
      state.deckRemaining > ADVANCED.solveAtDeck
        ? `Solve unlocks when ${ADVANCED.solveAtDeck} or fewer cards remain in the deck`
        : 'Close the circuit with the cards left in the deck, or lose';
    resignBtn.node.disabled = !active;
    controls.classList.toggle('is-disabled', !active);
    controls.hidden = !active;

    result.hidden = active;
    if (!active) {
      resultMsg.textContent = status.message;
      const next = state.players[1 - state.starterIndex];
      nextBtn.textContent = `Next game · ${next.name} starts`;
    }

    updateHint();
    scheduleDraw();
  }

  // ---- Advanced mode: hands ----
  /** Card backs for a hand. Function cards get their own back, so only their number is visible. */
  function backsOf(hand) {
    const back = (isFunction) =>
      el(
        'span',
        {
          class: `cc__back ${isFunction ? 'cc__back--fn' : 'cc__back--line'}`,
          title: isFunction ? 'A function card' : 'A straight or turn card',
        },
        isFunction ? '🎁' : '🐾',
      );
    const functions = hand.filter((c) => !isLineType(c.type)).length;
    return [...Array(hand.length - functions).fill(0).map(() => back(false)), ...Array(functions).fill(0).map(() => back(true))];
  }

  function handCard(card) {
    const selected = card.id === selectedCardId;
    const used = usedCardIds().has(card.id);
    const face = card.type === 'limit' ? '✋' : cardIcon(card.type, card.type === 'cross' ? 0 : rotOf(card));
    return el(
      'button',
      {
        class: `cc__hcard cc__hcard--${card.type}${selected && !used ? ' is-selected' : ''}${used ? ' is-used' : ''}`,
        title: CARD_INFO[card.type].tip,
        // A used Limit card can still be tapped to take it back
        disabled: used && card.type !== 'limit',
        onclick: () => pickCard(card),
        // Mouse hover shows what a function card does (touch has no hover, tapping does the same)
        onpointerenter: (e) => {
          if (e.pointerType === 'mouse' && !isLineType(card.type)) {
            hoverHelp = card.type;
            renderHelp();
          }
        },
        onpointerleave: () => {
          hoverHelp = null;
          renderHelp();
        },
      },
      el('span', { class: 'cc__hface', html: face }),
      el('span', { class: 'cc__hname' }, CARD_INFO[card.type].name),
    );
  }

  function renderHands(active, handPlay) {
    const show = isAdvanced() && active;
    oppRow.hidden = !show;
    handPanel.hidden = !(show && handPlay);
    if (!show) return;

    const nameOf = (id) => state.players.find((p) => p.id === id).name;
    const ownerId = handOwnerId() ?? actorId();
    const oppId = state.players.find((p) => p.id !== ownerId).id;
    const oppHand = state.hands[oppId];
    oppLabel.textContent = `${nameOf(oppId)}'s hand: ${oppHand.length} card${oppHand.length === 1 ? '' : 's'}`;
    oppBacks.replaceChildren(...backsOf(oppHand));

    if (!handPlay) return;
    const hand = state.hands[ownerId];
    if (handCovered()) {
      pinnedHelp = hoverHelp = null;
      renderHelp();
      handLabel.textContent = `Pass the device to ${nameOf(ownerId)}`;
      handCards.replaceChildren(
        ...backsOf(hand),
        el('button', { class: 'btn', onclick: () => { revealedKey = turnKey(); refresh(); } }, `Show ${nameOf(ownerId)}'s cards`),
      );
      return;
    }
    // Start every turn with a line card selected, so a single tap on the board places something
    if (!selectedCard()) {
      selectedCardId = (unusedCards(kind)[0] ?? unusedCards('straight')[0] ?? unusedCards('turn')[0])?.id ?? null;
    }
    const selected = selectedCard();
    if (selected && isLineType(selected.type)) kind = selected.type;
    handLabel.textContent = `${nameOf(ownerId)}'s hand`;
    const sorted = [...hand].sort((a, b) => HAND_ORDER.indexOf(a.type) - HAND_ORDER.indexOf(b.type));
    handCards.replaceChildren(...sorted.map(handCard));
    renderHelp();
  }

  /** Default hint line, including a live "this closes the circuit" check for the current draft. */
  function updateHint() {
    hint.classList.remove('is-error', 'is-good');
    if (!state || state.phase === 'over') {
      hint.textContent = '';
    } else if (draft.some(hasPosition) && isWinningBoard(mergedBoard(), state.options)) {
      hint.textContent = 'This closes the circuit! Press End turn to win.';
      hint.classList.add('is-good');
    } else if (inHandPlay() && handCovered()) {
      hint.textContent = 'Only the player on the move should look: press the button below to show your hand.';
    } else if (boardIsEmpty() && !draft.length) {
      hint.textContent = 'Place the first card in the highlighted center cell.';
    } else if (inHandPlay() && selectedCard()?.type === 'cross') {
      hint.textContent = 'Tap a straight line on the board to turn it into an intersection (+).';
    } else if (inHandPlay()) {
      hint.textContent = 'Pick a card from your hand, then tap a cell next to the board. Press End turn when done.';
    } else if (state.phase === 'solve') {
      hint.textContent = 'Close the circuit with the cards left in the deck, then submit. Every line end must be connected.';
    } else if (state.phase === 'challenge') {
      hint.textContent = 'Place cards so that every line end is connected, then submit.';
    } else {
      hint.textContent = draft.length
        ? 'Add cards next to this turn\'s cards, in one straight line (up to 3).'
        : 'Tap any empty cell to place a card. Cards in one turn must form a straight line.';
    }
  }

  // ---- Timer ----
  function tick() {
    timerEl.classList.toggle('is-unlimited', Boolean(state) && state.phase !== 'over' && state.deadline === null);
    if (!state || state.phase === 'over') {
      timerFill.style.width = '0%';
      timerText.textContent = '–';
      timerEl.classList.remove('is-low');
      return;
    }
    if (state.deadline === null) {
      // No time limit: show it, and never report a timeout
      timerFill.style.width = '100%';
      timerText.textContent = '∞ No time limit';
      timerEl.classList.remove('is-low');
      return;
    }
    const left = Math.max(0, state.deadline - Date.now());
    const total = state.deadline - state.turnStartedAt;
    timerFill.style.width = `${Math.min(100, (left / total) * 100)}%`;
    timerText.textContent = `${Math.ceil(left / 1000)}s`;
    timerEl.classList.toggle('is-low', left < 10000);
    if (left === 0 && timeoutSentFor !== turnKey()) {
      timeoutSentFor = turnKey(); // report each expiry only once
      api.dispatch({ type: 'TIMEOUT' });
    }
  }
  const timerId = setInterval(tick, 100);

  // ---- Input ----
  const canvasPoint = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Active pointers (fingers or mouse). Two fingers = pinch zoom + two-finger pan.
  const pointers = new Map();
  let pinch = null;
  const pointerPair = () => [...pointers.values()].slice(0, 2);
  const pairMetrics = ([a, b]) => ({ dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });

  canvas.addEventListener('pointerdown', (e) => {
    // The first finger of a gesture is "primary". Drop any stale pointers a missed
    // pointerup/cancel may have left behind, so a single finger is never mistaken for a pinch.
    if (e.isPrimary) {
      pointers.clear();
      pinch = null;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is only an optimization (keeps receiving moves outside the canvas)
    }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      dragging = { startX: e.clientX, startY: e.clientY, camX: cam.cx, camY: cam.cy, moved: false };
    } else if (pointers.size === 2) {
      if (dragging) dragging.moved = true; // a second finger turns the touch into a gesture, not a tap
      pinch = pairMetrics(pointerPair());
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);

    if (pinch && pointers.size >= 2) {
      // Keep the world point that was under the old midpoint under the new midpoint, while rescaling.
      const next = pairMetrics(pointerPair());
      const r = canvas.getBoundingClientRect();
      const wx = (pinch.mid[0] - r.left - cssW / 2) / cam.size + cam.cx;
      const wy = (pinch.mid[1] - r.top - cssH / 2) / cam.size + cam.cy;
      cam.size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, cam.size * (next.dist / pinch.dist)));
      cam.cx = wx - (next.mid[0] - r.left - cssW / 2) / cam.size;
      cam.cy = wy - (next.mid[1] - r.top - cssH / 2) / cam.size;
      pinch = next;
      scheduleDraw();
      return;
    }

    const [px, py] = canvasPoint(e);
    if (dragging) {
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      if (!dragging.moved && Math.hypot(dx, dy) > 5) dragging.moved = true;
      if (dragging.moved) {
        cam.cx = dragging.camX - dx / cam.size;
        cam.cy = dragging.camY - dy / cam.size;
        canvas.classList.add('is-panning');
      }
    }
    const [x, y] = toCell(px, py);
    if (!hover || hover.x !== x || hover.y !== y) hover = { x, y };
    if (state && state.phase !== 'over' && draft.length < maxDraft() && !dragging?.moved) {
      const problem = problemAt(x, y);
      if (problem) {
        showError(problem);
      } else {
        updateHint();
      }
    }
    scheduleDraw();
  });
  function releasePointer(e, allowTap) {
    pointers.delete(e.pointerId);
    pinch = null;
    if (allowTap && dragging && !dragging.moved && pointers.size === 0) {
      const [x, y] = toCell(...canvasPoint(e));
      placeAt(x, y);
    }
    if (pointers.size === 1) {
      // One finger left after a pinch: continue as a pan from where it is now, never as a tap
      const [[x, y]] = pointers.values();
      dragging = { startX: x, startY: y, camX: cam.cx, camY: cam.cy, moved: true };
    } else {
      dragging = null;
      canvas.classList.remove('is-panning');
    }
  }
  canvas.addEventListener('pointerup', (e) => releasePointer(e, true));
  canvas.addEventListener('pointercancel', (e) => releasePointer(e, false));
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    scheduleDraw();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [px, py] = canvasPoint(e);
      const wx = (px - cssW / 2) / cam.size + cam.cx;
      const wy = (py - cssH / 2) / cam.size + cam.cy;
      cam.size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, cam.size * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      cam.cx = wx - (px - cssW / 2) / cam.size;
      cam.cy = wy - (py - cssH / 2) / cam.size;
      scheduleDraw();
    },
    { passive: false },
  );
  // Belt and braces for browsers that ignore `touch-action: none`: never let a touch on the
  // board scroll or page-zoom the whole site.
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // A long-press on a touch screen also fires this; only a real right-click should rotate.
    if (e.pointerType !== 'touch') rotate();
  });

  const onKey = (e) => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'r') rotate();
    else if (k === 't') setKind(kind === 'straight' ? 'turn' : 'straight');
    else if (k === 'z' || k === 'backspace') undo();
  };
  window.addEventListener('keydown', onKey);

  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(boardWrap);
  resizeCanvas();

  return {
    update(next) {
      const previous = state;
      state = next;
      if (!previous) fillHowTo(isAdvanced());
      // A new turn, challenge or game invalidates any half-built draft.
      if (!previous || previous.gameNumber !== next.gameNumber) {
        draft = [];
        selectedCardId = null;
        cardRots = {}; // card ids restart with every game
        recenter();
      } else if (turnKey() !== `${previous.gameNumber}:${previous.turnNumber}:${previous.phase}`) {
        draft = [];
        selectedCardId = null;
        pinnedHelp = null;
      }
      challengeBtn.disarm();
      solveBtn.disarm();
      resignBtn.disarm();
      refresh();
      tick();
    },
    destroy() {
      clearInterval(timerId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
