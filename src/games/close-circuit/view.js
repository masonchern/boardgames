import { el } from '../../core/dom.js';
import { rules, placementProblem, centerCell } from './rules.js';
import { CARD_KINDS, E, S, cellKey, openEnds, isWinningBoard, pieceEnds } from './circuit.js';

/**
 * SVG preview of a card in a given rotation, drawn from the same line ends the board uses,
 * so the button always shows exactly what will be placed. 24x24 cell, ends at the edge midpoints.
 */
function cardIcon(kind, rot) {
  const mid = [[12, 0], [24, 12], [12, 24], [0, 12]]; // N, E, S, W
  const [a, b] = pieceEnds(kind, rot);
  const [ax, ay] = mid[a];
  const [bx, by] = mid[b];
  let path;
  if (kind === 'straight') {
    path = `M${ax} ${ay}L${bx} ${by}`;
  } else {
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
    '<rect x="0.75" y="0.75" width="22.5" height="22.5" rx="3" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.5"/>' +
    `<path d="${path}" stroke="currentColor" stroke-width="4.5"/>` +
    '</svg>'
  );
}

const MIN_SIZE = 14; // zoom limits, in pixels per cell
const MAX_SIZE = 96;
const DEFAULT_SIZE = 56;

/**
 * Close Circuit view: renders the state on a canvas and turns clicks into actions.
 * A turn is drafted locally (pieces placed but not yet submitted) and sent to the
 * authority as ONE atomic PLAY action. The view never changes game state itself.
 *
 * @type {import('../../core/types.js').GameModule['mount']}
 */
export function mount(container, api) {
  const players = api.players;
  const colors = { [players[0].id]: '#6c8cff', [players[1].id]: '#ff6b9a' };

  // ---- View-local state (not game state) ----
  let state = null;
  let draft = []; // cards placed this turn but not submitted yet
  let kind = 'straight';
  let rot = 0;
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
  const hint = el('div', { class: 'cc__hint muted' });

  const canvas = el('canvas', { class: 'cc__canvas' });
  const recenterBtn = el('button', { class: 'btn btn--ghost cc__recenter', onclick: () => { recenter(); scheduleDraw(); } }, 'Recenter');
  const boardWrap = el('div', { class: 'cc__board' }, canvas, recenterBtn);

  // The icons are redrawn in refresh() so they follow the current rotation.
  const straightIcon = el('span', { class: 'cc__icon' });
  const turnIcon = el('span', { class: 'cc__icon' });
  const straightBtn = el('button', { class: 'cc__kind', title: 'Straight line (T)', onclick: () => setKind('straight') }, straightIcon, el('span', {}, 'Straight'));
  const turnBtn = el('button', { class: 'cc__kind', title: 'Turning line (T)', onclick: () => setKind('turn') }, turnIcon, el('span', {}, 'Turn'));
  const rotateBtn = el('button', { class: 'btn btn--ghost', title: 'Rotate (R or right-click)', onclick: rotate }, '⟳ Rotate');
  const countEl = el('div', { class: 'cc__count muted' });
  const undoBtn = el('button', { class: 'btn btn--ghost', title: 'Undo last card (Z)', onclick: undo }, 'Undo');
  const endBtn = el('button', { class: 'btn', onclick: submit }, 'End turn');
  const challengeBtn = confirmButton('No solution! (challenge)', 'Click again to challenge', () => api.dispatch({ type: 'CHALLENGE' }));
  const resignBtn = confirmButton('Resign', 'Click again to resign', () => api.dispatch({ type: 'CONCEDE' }));
  const openEndsToggle = el('input', { type: 'checkbox', checked: true, onchange: (e) => { showOpenEnds = e.target.checked; scheduleDraw(); } });

  const controls = el(
    'div',
    { class: 'cc__controls' },
    el('div', { class: 'cc__group' }, el('div', { class: 'cc__kinds' }, straightBtn, turnBtn), rotateBtn),
    el('div', { class: 'cc__group' }, countEl, undoBtn, endBtn),
    el('div', { class: 'cc__group' }, challengeBtn.node, resignBtn.node),
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

  const howTo = el(
    'details',
    { class: 'cc__how' },
    el('summary', {}, 'How to play'),
    el(
      'ul',
      {},
      el('li', {}, 'Both players share one deck of 48 line cards. Each card can be placed as a straight line or a 90° turn.'),
      el('li', {}, 'On your turn place 1 to 3 cards. The very first card goes in the center; every other card must touch a card already on the board. Then press End turn.'),
      el('li', {}, 'Close the circuit to win: every line end on the board must connect to another, with nothing sticking out. A square or rectangle works, a single line does not.'),
      el('li', {}, 'Instead of placing cards you can challenge with "No solution!". The other player then gets extra time and 1 to 3 cards to close the circuit. If they manage it they win, otherwise you do.'),
      el('li', {}, 'Run out of time and you lose the game. Player 1 starts the first game, player 2 the next, and so on.'),
      el('li', {}, 'Controls: click a cell to place · R or right-click rotates · T switches straight/turn · Z undoes · drag to pan · scroll to zoom. Red dots mark open line ends.'),
    ),
  );

  const root = el(
    'div',
    { class: 'cc' },
    el('div', { class: 'cc__hud' }, playerEls[0].node, centerHud, playerEls[1].node),
    banner,
    boardWrap,
    hint,
    controls,
    result,
    howTo,
  );
  container.append(root);

  // ---- Helpers ----
  const actorId = () => (state && state.phase !== 'over' ? state.players[state.current].id : null);
  const maxDraft = () => (state ? Math.min(state.options.maxPerTurn, state.deckRemaining) : 0);
  const turnKey = () => (state ? `${state.gameNumber}:${state.turnNumber}:${state.phase}` : null);
  const boardIsEmpty = () => Object.keys(state.board).length === 0;

  function mergedBoard() {
    const merged = { ...state.board };
    for (const p of draft) merged[cellKey(p.x, p.y)] = { ...p, owner: actorId() };
    return merged;
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
    rot %= CARD_KINDS[kind].rotations;
    refresh();
  }
  function rotate() {
    rot = (rot + 1) % CARD_KINDS[kind].rotations;
    refresh();
  }
  function undo() {
    if (!draft.length) return;
    draft.pop(); // only the last card can be removed, so every card still touches the board
    refresh();
  }
  function submit() {
    if (!state || state.phase === 'over' || !draft.length) return;
    api.dispatch({ type: 'PLAY', placements: draft.map(({ x, y, kind: k, rot: r }) => ({ x, y, kind: k, rot: r })) });
    draft = [];
    refresh();
  }

  function placeAt(x, y) {
    if (!state || state.phase === 'over' || draft.length >= maxDraft()) return;
    const problem = placementProblem(state, draft, { x, y, kind, rot });
    if (problem) {
      hint.textContent = problem;
      hint.classList.remove('is-good');
      hint.classList.add('is-error');
      return;
    }
    draft.push({ x, y, kind, rot });
    refresh();
  }

  // ---- Camera ----
  const toScreen = (wx, wy) => [(wx - cam.cx) * cam.size + cssW / 2, (wy - cam.cy) * cam.size + cssH / 2];
  const toCell = (px, py) => [
    Math.floor((px - cssW / 2) / cam.size + cam.cx),
    Math.floor((py - cssH / 2) / cam.size + cam.cy),
  ];

  function recenter() {
    const pieces = state ? Object.values(state.board) : [];
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
    const fit = Math.min(cssW / (maxX - minX + 5), cssH / (maxY - minY + 5));
    cam.size = Math.max(MIN_SIZE, Math.min(DEFAULT_SIZE, fit || DEFAULT_SIZE));
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

  /** Draw one card: a tile with a line (straight) or a quarter-circle (turn) between its two ends. */
  function drawPiece(ctx, piece, color, { alpha = 1, dashed = false, glow = false } = {}) {
    const s = cam.size;
    const [sx, sy] = toScreen(piece.x, piece.y);
    if (sx > cssW || sy > cssH || sx + s < 0 || sy + s < 0) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(sx + 1, sy + 1, s - 2, s - 2);
    if (glow || dashed) {
      ctx.strokeStyle = glow ? 'rgba(255,255,255,0.4)' : color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.strokeRect(sx + 1.5, sy + 1.5, s - 3, s - 3);
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, s * 0.2);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    const [a, b] = pieceEnds(piece.kind, piece.rot);
    const [ax, ay] = edgeMid(sx, sy, s, a);
    const [bx, by] = edgeMid(sx, sy, s, b);
    if (piece.kind === 'straight') {
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
    }
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    drawQueued = false;
    if (!state) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, cssW, cssH);

    const g = state.options.gridSize;
    const s = cam.size;
    const [gx, gy] = toScreen(0, 0);

    // Grid area and lines (clipped to the playable grid)
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, gy, g * s, g * s);
    ctx.clip();
    ctx.fillStyle = '#10131c';
    ctx.fillRect(gx, gy, g * s, g * s);

    const [vx0, vy0] = toCell(0, 0);
    const [vx1, vy1] = toCell(cssW, cssH);
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
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
      ctx.fillStyle = 'rgba(108,140,255,0.16)';
      ctx.fillRect(cx, cy, s, s);
      ctx.strokeStyle = 'rgba(108,140,255,0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx + 1, cy + 1, s - 2, s - 2);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(108,140,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(gx, gy, g * s, g * s);

    // Cards on the board (green once the circuit is closed)
    const won = state.phase === 'over' && isWinningBoard(state.board, state.options);
    const recent = new Set(state.lastPlaced);
    for (const [key, piece] of Object.entries(state.board)) {
      drawPiece(ctx, piece, won ? '#4fd1a5' : colors[piece.owner], { glow: recent.has(key) && state.phase !== 'over' });
    }

    const active = state.phase !== 'over';
    const me = colors[actorId()] ?? '#ffffff';

    // Cards drafted this turn
    for (const piece of draft) drawPiece(ctx, piece, me, { alpha: 0.85, dashed: true });

    // Ghost under the pointer
    if (active && hover && draft.length < maxDraft()) {
      const candidate = { x: hover.x, y: hover.y, kind, rot };
      const problem = placementProblem(state, draft, candidate);
      if (!problem) {
        drawPiece(ctx, candidate, me, { alpha: 0.4 });
      } else if (hover.x >= 0 && hover.y >= 0 && hover.x < g && hover.y < g) {
        const [hx, hy] = toScreen(hover.x, hover.y);
        ctx.fillStyle = 'rgba(255,93,93,0.14)';
        ctx.fillRect(hx, hy, s, s);
      }
    }

    // Open ends: line ends that do not connect to anything
    if (showOpenEnds) {
      ctx.fillStyle = '#ff5d5d';
      for (const end of openEnds(mergedBoard())) {
        const [sx, sy] = toScreen(end.x, end.y);
        const [ex, ey] = edgeMid(sx, sy, s, end.dir);
        ctx.beginPath();
        ctx.arc(ex, ey, Math.max(2.5, s * 0.07), 0, Math.PI * 2);
        ctx.fill();
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
    gameInfo.textContent = `Game ${state.gameNumber} · ${state.deckRemaining} of ${state.options.deckSize} cards left${state.draws ? ` · ${state.draws} draw${state.draws > 1 ? 's' : ''}` : ''}`;

    banner.textContent = status.message;
    banner.classList.toggle('is-challenge', challenge);
    banner.classList.toggle('is-over', !active);
    banner.style.setProperty('--pc', colors[status.currentPlayerId] ?? 'var(--primary)');

    straightBtn.classList.toggle('is-selected', kind === 'straight');
    turnBtn.classList.toggle('is-selected', kind === 'turn');
    // Each button previews the orientation that kind would have (same rule as setKind: rot % rotations)
    straightIcon.innerHTML = cardIcon('straight', rot % CARD_KINDS.straight.rotations);
    turnIcon.innerHTML = cardIcon('turn', rot % CARD_KINDS.turn.rotations);

    const max = maxDraft();
    countEl.textContent = active ? `Cards this turn: ${draft.length} / ${max}` : '';
    endBtn.textContent = challenge ? 'Submit solution' : 'End turn';
    endBtn.disabled = !active || !draft.length;
    undoBtn.disabled = !draft.length;
    challengeBtn.node.disabled = !(state.phase === 'play' && !boardIsEmpty() && !draft.length);
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

  /** Default hint line, including a live "this closes the circuit" check for the current draft. */
  function updateHint() {
    hint.classList.remove('is-error', 'is-good');
    if (!state || state.phase === 'over') {
      hint.textContent = '';
    } else if (draft.length && isWinningBoard(mergedBoard(), state.options)) {
      hint.textContent = 'This closes the circuit! Press End turn to win.';
      hint.classList.add('is-good');
    } else if (boardIsEmpty() && !draft.length) {
      hint.textContent = 'Place the first card in the highlighted center cell.';
    } else if (state.phase === 'challenge') {
      hint.textContent = 'Place cards so that every line end is connected, then submit.';
    } else {
      hint.textContent = 'Click a cell next to existing cards to place a card.';
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

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = { startX: e.clientX, startY: e.clientY, camX: cam.cx, camY: cam.cy, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
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
      const problem = placementProblem(state, draft, { x, y, kind, rot });
      if (problem) {
        hint.textContent = problem;
        hint.classList.remove('is-good');
        hint.classList.add('is-error');
      } else {
        updateHint();
      }
    }
    scheduleDraw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragging && !dragging.moved) {
      const [x, y] = toCell(...canvasPoint(e));
      placeAt(x, y);
    }
    dragging = null;
    canvas.classList.remove('is-panning');
  });
  canvas.addEventListener('pointercancel', () => {
    dragging = null;
    canvas.classList.remove('is-panning');
  });
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
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    rotate();
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
      // A new turn, challenge or game invalidates any half-built draft.
      if (!previous || previous.gameNumber !== next.gameNumber) {
        draft = [];
        recenter();
      } else if (turnKey() !== `${previous.gameNumber}:${previous.turnNumber}:${previous.phase}`) {
        draft = [];
      }
      challengeBtn.disarm();
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
