import { rules as closeCircuit, redact as closeCircuitRedact } from '../../src/games/close-circuit/rules.js';

/** Games the Worker can referee. Keys match client folder ids. */
export const GAMES = {
  'close-circuit': { rules: closeCircuit, redact: closeCircuitRedact },
};

export function getGame(gameId) {
  const game = GAMES[gameId];
  if (!game) {
    const err = new Error('Unknown game');
    err.status = 404;
    throw err;
  }
  return game;
}
