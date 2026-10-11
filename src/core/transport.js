/**
 * A Transport abstracts how actions reach the authority and how state comes back.
 *
 * Interface:
 *   connect(handlers)  -> register { onState(state, seq), onError(err) }
 *   send(msg)          -> msg = { playerId, action }
 *   close()
 *
 * Today:  LocalTransport (this device acts as the "server", for Pass-and-Play)
 * Future: WebSocketTransport (send -> ws.send, ws.onmessage -> onState)
 *         Session and game code need no changes.
 */

/**
 * Local in-memory "fake server": validates and applies actions, then broadcasts the
 * new state asynchronously. The async hop intentionally mimics network behavior so
 * games never rely on synchronous updates.
 */
export class LocalTransport {
  /** @param {import('./types.js').GameRules} rules @param {import('./types.js').Player[]} players */
  constructor(rules, players) {
    this.rules = rules;
    this.players = players;
    this.state = rules.setup({ players });
    this.seq = 0;
    this.handlers = null;
    this.closed = false;
  }

  connect(handlers) {
    this.handlers = handlers;
    queueMicrotask(() => this.handlers?.onState(this.state, this.seq));
  }

  send({ playerId, action }) {
    queueMicrotask(() => {
      if (this.closed) return;
      const verdict = this.rules.validate(this.state, action, playerId);
      if (!verdict.ok) {
        this.handlers?.onError(new Error(verdict.error || 'Invalid action'));
        return;
      }
      this.state = this.rules.reduce(this.state, action, playerId);
      this.seq += 1;
      this.handlers?.onState(this.state, this.seq);
    });
  }

  close() {
    this.closed = true;
    this.handlers = null;
  }
}

/**
 * Sketch of the future online transport (not implemented, interface demo only).
 *
 * export class WebSocketTransport {
 *   constructor(url, roomId, token) {...}
 *   connect(handlers) { this.ws = new WebSocket(url); this.ws.onmessage = e => {
 *       const m = JSON.parse(e.data); if (m.type === 'STATE') handlers.onState(m.state, m.seq);
 *   }; }
 *   send(msg) { this.ws.send(JSON.stringify({ type: 'ACTION', ...msg })); }
 *   close() { this.ws.close(); }
 * }
 */
