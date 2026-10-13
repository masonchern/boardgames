import { getGame } from './games.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomSeed = () => Math.floor(Math.random() * 2 ** 32);
/** How long the remaining player must wait after a disconnect before they can claim the win. */
export const DISCONNECT_WAIT_MS = 2 * 60 * 1000;

export function newRoomCode() {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

function emptyMeta({ code, gameId, options, host }) {
  return {
    code,
    gameId,
    options: options ?? {},
    hostId: host.id,
    seats: [{ id: host.id, name: host.name, kind: host.kind }],
    phase: 'lobby', // lobby | playing
    seq: 0,
    recorded: false,
    gameOver: false,
    away: null, // { userId, since } while a seated player has no live socket
  };
}

/**
 * One Durable Object per room: waiting lobby + the live match.
 * Game state lives in DO storage; browsers attach with WebSockets.
 */
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/init' && request.method === 'POST') {
      const body = await request.json();
      const existing = await this.ctx.storage.get('meta');
      if (existing && existing.seats?.length) return Response.json(this.publicMeta(existing));
      const meta = emptyMeta(body);
      await this.ctx.storage.put('meta', meta);
      return Response.json(this.publicMeta(meta));
    }

    if (path === '/snapshot') {
      const meta = await this.ctx.storage.get('meta');
      if (!meta) return Response.json({ error: 'Room not found' }, { status: 404 });
      return Response.json(this.publicMeta(meta));
    }

    if (path === '/join' && request.method === 'POST') {
      const { user } = await request.json();
      try {
        const meta = await this.join(user);
        await this.broadcastRoom(meta);
        return Response.json(this.publicMeta(meta));
      } catch (err) {
        return Response.json({ error: err.message }, { status: err.status || 400 });
      }
    }

    if (path === '/start' && request.method === 'POST') {
      const { userId } = await request.json();
      try {
        const meta = await this.start(userId);
        await this.broadcastAll();
        return Response.json(this.publicMeta(meta));
      } catch (err) {
        return Response.json({ error: err.message }, { status: err.status || 400 });
      }
    }

    if (path === '/leave' && request.method === 'POST') {
      const { userId } = await request.json();
      const meta = await this.leave(userId);
      await this.broadcastRoom(meta);
      return Response.json(this.publicMeta(meta));
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      const user = {
        id: url.searchParams.get('userId'),
        name: url.searchParams.get('name') || 'Player',
        kind: url.searchParams.get('kind') || 'guest',
      };
      if (!user.id) return new Response('Missing user', { status: 401 });
      try {
        await this.join(user);
      } catch (err) {
        return new Response(err.message, { status: err.status || 400 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ userId: user.id });
      this.ctx.waitUntil(this.hello(server, user.id));
      this.ctx.waitUntil(this.markPresent(user.id));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  publicMeta(meta) {
    return {
      code: meta.code,
      gameId: meta.gameId,
      options: meta.options,
      hostId: meta.hostId,
      seats: meta.seats,
      phase: meta.phase,
      seq: meta.seq,
      gameOver: Boolean(meta.gameOver),
      away: meta.away
        ? { userId: meta.away.userId, since: meta.away.since, waitMs: DISCONNECT_WAIT_MS }
        : null,
    };
  }

  socketsFor(userId) {
    return this.ctx.getWebSockets().filter((ws) => {
      try {
        return ws.deserializeAttachment()?.userId === userId;
      } catch {
        return false;
      }
    });
  }

  async markPresent(userId) {
    const meta = await this.ctx.storage.get('meta');
    if (!meta?.away || meta.away.userId !== userId) return;
    meta.away = null;
    await this.ctx.storage.put('meta', meta);
    await this.broadcastRoom(meta);
  }

  async markAway(userId) {
    if (this.socketsFor(userId).length > 0) return;
    const meta = await this.ctx.storage.get('meta');
    if (!meta || meta.phase !== 'playing') return;
    if (!meta.seats.some((s) => s.id === userId)) return;
    const state = await this.ctx.storage.get('state');
    if (!state || state.phase === 'over') return;
    if (meta.away?.userId === userId) return;
    meta.away = { userId, since: Date.now() };
    await this.ctx.storage.put('meta', meta);
    await this.broadcastRoom(meta);
  }

  async claimDisconnect(claimerId) {
    const meta = await this.ctx.storage.get('meta');
    const away = meta?.away;
    if (!away) throw new Error('Nobody is disconnected');
    if (away.userId === claimerId) throw new Error('You cannot claim a win for leaving');
    if (!meta.seats.some((s) => s.id === claimerId)) throw new Error('You are not in this room');
    if (this.socketsFor(away.userId).length > 0) throw new Error('They are back');
    if (Date.now() < away.since + DISCONNECT_WAIT_MS) throw new Error('Wait until 2 minutes have passed');
    const state = await this.ctx.storage.get('state');
    if (!state || state.phase === 'over') throw new Error('The game is already over');
    await this.apply(away.userId, { type: 'FORFEIT' });
    const next = await this.ctx.storage.get('meta');
    if (next) {
      next.away = null;
      await this.ctx.storage.put('meta', next);
    }
  }

  async join(user) {
    const meta = await this.ctx.storage.get('meta');
    if (!meta) {
      const err = new Error('Room not found');
      err.status = 404;
      throw err;
    }
    if (meta.seats.some((s) => s.id === user.id)) return meta;
    if (meta.phase === 'playing') {
      const err = new Error('This game has already started');
      err.status = 409;
      throw err;
    }
    if (meta.seats.length >= 2) {
      const err = new Error('This room is full');
      err.status = 409;
      throw err;
    }
    meta.seats.push({ id: user.id, name: user.name, kind: user.kind });
    await this.ctx.storage.put('meta', meta);
    return meta;
  }

  async leave(userId) {
    const meta = await this.ctx.storage.get('meta');
    if (!meta || meta.phase === 'playing') return meta;
    meta.seats = meta.seats.filter((s) => s.id !== userId);
    if (userId === meta.hostId && meta.seats[0]) meta.hostId = meta.seats[0].id;
    await this.ctx.storage.put('meta', meta);
    return meta;
  }

  async start(userId) {
    const meta = await this.ctx.storage.get('meta');
    if (!meta) throw Object.assign(new Error('Room not found'), { status: 404 });
    if (userId !== meta.hostId) throw Object.assign(new Error('Only the host can start'), { status: 403 });
    if (meta.phase === 'playing') return meta;
    if (meta.seats.length < 2) throw Object.assign(new Error('Need two players to start'), { status: 400 });

    const { rules } = getGame(meta.gameId);
    const players = meta.seats.map((s) => ({ id: s.id, name: s.name }));
    const now = Date.now();
    const state = rules.setup({ players, options: meta.options, now, seed: randomSeed() });
    meta.phase = 'playing';
    meta.seq = 0;
    meta.recorded = false;
    meta.gameOver = false;
    meta.away = null;
    await this.ctx.storage.put('meta', meta);
    await this.ctx.storage.put('state', state);
    return meta;
  }

  async hello(ws, userId) {
    const meta = await this.ctx.storage.get('meta');
    if (!meta) return;
    ws.send(JSON.stringify({ type: 'ROOM', room: this.publicMeta(meta) }));
    if (meta.phase === 'playing') {
      const state = await this.ctx.storage.get('state');
      ws.send(JSON.stringify({ type: 'STATE', state: this.redact(meta, state, userId), seq: meta.seq }));
    }
  }

  redact(meta, state, userId) {
    const { redact } = getGame(meta.gameId);
    return redact ? redact(state, userId) : state;
  }

  async broadcastRoom(meta) {
    const body = JSON.stringify({ type: 'ROOM', room: this.publicMeta(meta) });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        /* ignore */
      }
    }
  }

  async broadcastAll() {
    const meta = await this.ctx.storage.get('meta');
    const state = await this.ctx.storage.get('state');
    if (!meta) return;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const { userId } = ws.deserializeAttachment() || {};
        ws.send(JSON.stringify({ type: 'ROOM', room: this.publicMeta(meta) }));
        if (meta.phase === 'playing' && state) {
          ws.send(JSON.stringify({ type: 'STATE', state: this.redact(meta, state, userId), seq: meta.seq }));
        }
      } catch {
        /* ignore */
      }
    }
  }

  sendError(ws, message) {
    try {
      ws.send(JSON.stringify({ type: 'ERROR', error: message }));
    } catch {
      /* ignore */
    }
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.sendError(ws, 'Bad message');
    }
    const { userId } = ws.deserializeAttachment() || {};
    if (!userId) return this.sendError(ws, 'Not signed in');

    if (msg.type === 'START') {
      try {
        await this.start(userId);
        await this.broadcastAll();
      } catch (err) {
        this.sendError(ws, err.message);
      }
      return;
    }

    if (msg.type === 'CLAIM_DISCONNECT') {
      try {
        await this.claimDisconnect(userId);
        await this.broadcastAll();
      } catch (err) {
        this.sendError(ws, err.message);
      }
      return;
    }

    if (msg.type === 'ACTION') {
      try {
        await this.apply(userId, msg.action);
        await this.broadcastAll();
      } catch (err) {
        this.sendError(ws, err.message);
      }
    }
  }

  async apply(userId, action) {
    const meta = await this.ctx.storage.get('meta');
    if (!meta || meta.phase !== 'playing') throw new Error('The game has not started');
    const state = await this.ctx.storage.get('state');
    const { rules } = getGame(meta.gameId);
    const metaStamp = { now: Date.now(), seed: randomSeed() };
    const verdict = rules.validate(state, action, userId, metaStamp);
    if (!verdict.ok) throw new Error(verdict.error || 'Invalid action');
    const next = rules.reduce(state, action, userId, metaStamp);
    meta.seq += 1;
    meta.gameOver = next.phase === 'over';
    await this.ctx.storage.put('state', next);
    await this.ctx.storage.put('meta', meta);
    if (next.phase === 'over' && !meta.recorded) {
      await this.recordMatch(meta, next);
      meta.recorded = true;
      await this.ctx.storage.put('meta', meta);
    }
    // A new game in the series: allow a later result to be recorded again
    if (state.phase === 'over' && next.phase !== 'over') {
      meta.recorded = false;
      meta.gameOver = false;
      await this.ctx.storage.put('meta', meta);
    }
  }

  async recordMatch(meta, state) {
    const [p1, p2] = meta.seats;
    if (!p1 || !p2) return;
    const winnerId = state.result?.winnerId ?? null;
    const counted = p1.kind === 'user' && p2.kind === 'user' ? 1 : 0;
    await this.env.DB.prepare(
      `INSERT INTO matches (id, game_id, room_code, p1_id, p2_id, winner_id, counted, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), meta.gameId, meta.code, p1.id, p2.id, winnerId, counted, Date.now())
      .run();
    if (!counted) return;
    if (winnerId) {
      await this.env.DB.prepare('UPDATE users SET wins = wins + 1 WHERE id = ?').bind(winnerId).run();
      const loserId = winnerId === p1.id ? p2.id : p1.id;
      await this.env.DB.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?').bind(loserId).run();
    }
  }

  async webSocketClose(ws) {
    try {
      const { userId } = ws.deserializeAttachment() || {};
      if (userId) await this.markAway(userId);
    } catch {
      /* ignore */
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}
