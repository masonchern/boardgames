import { LocalTransport } from './transport.js';

/**
 * GameSession: the client-side "match".
 * One-way data flow:
 *   View --dispatch(action)--> Transport --(authority validates/reduces)--> onState --> View.update
 */
export class GameSession {
  /**
   * @param {Object} opts
   * @param {import('./types.js').GameRules} opts.rules
   * @param {import('./types.js').Player[]} opts.players
   * @param {'local'|'online'} [opts.mode]
   * @param {string|null} [opts.localPlayerId]
   * @param {Object} [opts.options]  Pre-game settings (passed to rules.setup)
   * @param {{connect:Function,send:Function,close:Function}} [opts.transport]
   */
  constructor({ rules, players, mode = 'local', localPlayerId = null, options = {}, transport }) {
    this.rules = rules;
    this.players = players;
    this.mode = mode;
    this.localPlayerId = localPlayerId;
    this.transport = transport ?? new LocalTransport(rules, players, options);
    /** @type {any} */
    this.state = null;
    this.seq = -1;
    this.listeners = new Set();
    this.errorListeners = new Set();
  }

  start() {
    this.transport.connect({
      onState: (state, seq) => {
        this.state = state;
        this.seq = seq;
        this.listeners.forEach((fn) => fn(state));
      },
      onError: (err) => this.errorListeners.forEach((fn) => fn(err)),
    });
  }

  getState() {
    return this.state;
  }

  getStatus() {
    return this.state ? this.rules.getStatus(this.state) : null;
  }

  /** @returns {() => void} unsubscribe */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onError(fn) {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  /**
   * Send an action.
   * - Local pass-and-play: if playerId is omitted, acts as the player whose turn it is.
   * - Online: always uses localPlayerId (the server must re-verify identity anyway).
   */
  dispatch(action, playerId) {
    const status = this.getStatus();
    const actor =
      this.mode === 'online'
        ? this.localPlayerId
        : playerId ?? status?.currentPlayerId ?? this.players[0].id;
    this.transport.send({ playerId: actor, action });
  }

  destroy() {
    this.transport.close();
    this.listeners.clear();
    this.errorListeners.clear();
  }
}
