/**
 * A Transport abstracts how actions reach the authority and how state comes back.
 *
 * Interface:
 *   connect(handlers)  -> register { onState(state, seq), onError(err) }
 *   send(msg)          -> msg = { playerId, action }
 *   close()
 *
 * Today:  LocalTransport (this device acts as the "server", for Pass-and-Play)
 *         WebSocketTransport (online rooms: send -> ws.send, ws.onmessage -> onState)
 *         Session and game code need no changes.
 */

/** A fresh random 32-bit seed. Randomness lives here (the authority), never inside rules. */
const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/**
 * Local in-memory "fake server": validates and applies actions, then broadcasts the
 * new state asynchronously. The async hop intentionally mimics network behavior so
 * games never rely on synchronous updates.
 */
export class LocalTransport {
  /**
   * @param {import('./types.js').GameRules} rules
   * @param {import('./types.js').Player[]} players
   * @param {Object} [options]  Pre-game settings chosen on the setup screen
   */
  constructor(rules, players, options = {}) {
    this.rules = rules;
    this.players = players;
    this.state = rules.setup({ players, options, now: Date.now(), seed: randomSeed() });
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
      // The authority stamps the time and a random seed (for shuffles). A real server would
      // do the same with its own clock and randomness; rules themselves stay deterministic.
      const meta = { now: Date.now(), seed: randomSeed() };
      const verdict = this.rules.validate(this.state, action, playerId, meta);
      if (!verdict.ok) {
        this.handlers?.onError(new Error(verdict.error || 'Invalid action'));
        return;
      }
      this.state = this.rules.reduce(this.state, action, playerId, meta);
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
 * Online transport: actions go to the room Durable Object, redacted state comes back.
 * The server ignores the client-supplied playerId and uses the session instead.
 */
export class WebSocketTransport {
  /**
   * @param {string} url  Already includes the session token as `?token=`
   */
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = null;
    this.closed = false;
    this.roomListeners = new Set();
    this.lastState = null;
    this.lastRoom = null;
    this.queue = [];
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
  }

  connect(handlers) {
    if (handlers) this.handlers = handlers;
    if (this.lastState) this.handlers?.onState(this.lastState.state, this.lastState.seq);
    if (this.lastRoom) this.roomListeners.forEach((fn) => fn(this.lastRoom));
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      for (const payload of this.queue) this.ws.send(payload);
      this.queue = [];
    };
    this.ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'STATE') {
        this.lastState = { state: msg.state, seq: msg.seq };
        this.handlers?.onState(msg.state, msg.seq);
      } else if (msg.type === 'ERROR') this.handlers?.onError(new Error(msg.error || 'Server rejected the action'));
      else if (msg.type === 'ROOM') {
        this.lastRoom = msg.room;
        this.roomListeners.forEach((fn) => fn(msg.room));
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (this.closed) return;
      this.reconnectAttempt += 1;
      const delay = Math.min(8000, 1000 * this.reconnectAttempt);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  onRoom(fn) {
    this.roomListeners.add(fn);
    return () => this.roomListeners.delete(fn);
  }

  send({ action, type = 'ACTION' }) {
    const payload = JSON.stringify(
      type === 'START'
        ? { type: 'START' }
        : type === 'CLAIM_DISCONNECT'
          ? { type: 'CLAIM_DISCONNECT' }
          : { type: 'ACTION', action },
    );
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(payload);
    else this.queue.push(payload);
  }

  startGame() {
    this.send({ type: 'START' });
  }

  claimDisconnect() {
    this.send({ type: 'CLAIM_DISCONNECT' });
  }

  close() {
    this.closed = true;
    this.handlers = null;
    this.roomListeners.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
