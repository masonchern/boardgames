/**
 * Close Circuit: geometry and circuit detection.
 * Pure functions, no DOM. Shared by the rules and the view.
 *
 * Model
 * - The board is an object keyed by "x,y": { x, y, kind, rot, owner, turn }.
 * - Every card has a list of "ends", each pointing at one of the four sides of its cell
 *   (straights and turns have two; the advanced-mode crossing has all four).
 * - Two neighbouring cards are connected when their facing ends match
 *   (e.g. my EAST end meets the neighbour's WEST end).
 *
 * Extension point: add new card kinds to CARD_KINDS (the circuit logic below works with any
 * card that lists its ends; advanced mode's crossing "cross" is one), or change
 * `isWinningBoard` to apply different win conditions.
 */

// Directions, clockwise from north.
export const N = 0;
export const E = 1;
export const S = 2;
export const W = 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export const opposite = (dir) => (dir + 2) % 4;
export const cellKey = (x, y) => `${x},${y}`;

/**
 * Card kinds. `rotations` = number of visually distinct orientations,
 * `ends(rot)` = the two sides the line leaves through.
 */
export const CARD_KINDS = {
  straight: {
    rotations: 2,
    // rot 0 = horizontal, rot 1 = vertical
    ends: (rot) => (rot % 2 === 0 ? [E, W] : [N, S]),
  },
  turn: {
    rotations: 4,
    // 90-degree turn; each rotation turns it clockwise by a quarter
    ends: (rot) => [[N, E], [E, S], [S, W], [W, N]][rot % 4],
  },
  cross: {
    // Advanced mode: a straight turned into an intersection (+). All four sides must connect.
    rotations: 1,
    ends: () => [N, E, S, W],
  },
};

/** Card kinds that can be placed from a hand or the deck (the rest are function cards). */
export const LINE_KINDS = ['straight', 'turn'];

export const pieceEnds = (kind, rot) => CARD_KINDS[kind].ends(rot);

/** Does the end of `piece` pointing in `dir` meet a matching end on the neighbouring card? */
function isConnected(board, piece, dir) {
  const neighbour = board[cellKey(piece.x + DX[dir], piece.y + DY[dir])];
  return Boolean(neighbour) && pieceEnds(neighbour.kind, neighbour.rot).includes(opposite(dir));
}

/** Every line end that points at empty space or at a card that does not connect back. */
export function openEnds(board) {
  const open = [];
  for (const piece of Object.values(board)) {
    for (const dir of pieceEnds(piece.kind, piece.rot)) {
      if (!isConnected(board, piece, dir)) open.push({ x: piece.x, y: piece.y, dir });
    }
  }
  return open;
}

/** Basic rule: a non-empty board with no open ends anywhere is a closed circuit. */
export function isClosed(board) {
  return Object.keys(board).length > 0 && openEnds(board).length === 0;
}

/**
 * The win condition. Today this is simply "closed circuit". An advanced mode could
 * require a single loop, a minimum size, etc., driven by `options`.
 */
export function isWinningBoard(board, _options) {
  return isClosed(board);
}
