import { corsHeaders, json, error } from './cors.js';
import {
  publicUser,
  getSessionUser,
  requireUser,
  createSession,
  createGuest,
  makePassword,
  checkPassword,
  normalizeUsername,
  normalizeName,
  syncUserRecord,
} from './auth.js';
import { getGame } from './games.js';
import { Hub, hubStub, notifyUser, whoIsOnline } from './hub.js';
import { Room, newRoomCode } from './room.js';

export { Hub, Room };

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    try {
      return await handle(request, env);
    } catch (err) {
      const status = err.status || 500;
      console.error(err);
      return error(request, err.message || 'Server error', status);
    }
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = request.method;

  if (path === '/ws/hub' && request.headers.get('Upgrade') === 'websocket') {
    const user = await requireUser(env, request);
    const stub = hubStub(env);
    const dest = new URL('https://hub/ws');
    dest.searchParams.set('userId', user.id);
    return stub.fetch(dest.toString(), request);
  }

  if (path.startsWith('/ws/room/') && request.headers.get('Upgrade') === 'websocket') {
    const user = await requireUser(env, request);
    const code = path.slice('/ws/room/'.length).toUpperCase();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const dest = new URL('https://room/ws');
    dest.searchParams.set('userId', user.id);
    dest.searchParams.set('name', user.name);
    dest.searchParams.set('kind', user.kind);
    return stub.fetch(dest.toString(), request);
  }

  if (method === 'POST' && path === '/api/register') {
    const body = await request.json().catch(() => ({}));
    const username = normalizeUsername(body.username);
    const password = String(body.password || '');
    if (password.length < 6) return error(request, 'Password must be at least 6 characters');
    const name = normalizeName(body.name, username);
    const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (exists) return error(request, 'That username is taken', 409);
    const { salt, hash } = await makePassword(password);
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO users (id, username, name, kind, password_hash, password_salt, created_at, last_seen)
       VALUES (?, ?, ?, 'user', ?, ?, ?, ?)`,
    )
      .bind(id, username, name, hash, salt, now, now)
      .run();
    const token = await createSession(env, id);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    return json(request, { token, user: publicUser(user) });
  }

  if (method === 'POST' && path === '/api/login') {
    const body = await request.json().catch(() => ({}));
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const row = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND kind = ?').bind(username, 'user').first();
    if (!row || !(await checkPassword(password, row.password_salt, row.password_hash))) {
      return error(request, 'Wrong username or password', 401);
    }
    const token = await createSession(env, row.id);
    return json(request, { token, user: publicUser(row) });
  }

  if (method === 'POST' && path === '/api/guest') {
    const body = await request.json().catch(() => ({}));
    const data = await createGuest(env, body.name);
    return json(request, data);
  }

  if (method === 'POST' && path === '/api/logout') {
    const user = await getSessionUser(env, request);
    if (user) {
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return json(request, { ok: true });
  }

  if (method === 'GET' && path === '/api/me') {
    const user = await requireUser(env, request);
    await syncUserRecord(env, user);
    return json(request, { user: publicUser(user) });
  }

  if (method === 'POST' && path === '/api/me/name') {
    const user = await requireUser(env, request);
    const body = await request.json().catch(() => ({}));
    const name = normalizeName(body.name, user.name);
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
    user.name = name;
    return json(request, { user: publicUser(user) });
  }

  if (method === 'GET' && path === '/api/friends') {
    const user = await requireUser(env, request);
    const rows = await env.DB.prepare(
      `SELECT f.id, f.status, f.requester_id, f.addressee_id,
              u.id AS uid, u.username, u.name, u.kind, u.wins, u.losses
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE f.requester_id = ? OR f.addressee_id = ?`,
    )
      .bind(user.id, user.id, user.id)
      .all();
    const list = rows.results || [];
    const online = await whoIsOnline(
      env,
      list.filter((r) => r.status === 'accepted').map((r) => r.uid),
    );
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of list) {
      const other = publicUser({ id: r.uid, username: r.username, name: r.name, kind: r.kind, wins: r.wins, losses: r.losses });
      other.online = Boolean(online[r.uid]);
      if (r.status === 'accepted') friends.push({ id: r.id, user: other });
      else if (r.addressee_id === user.id) incoming.push({ id: r.id, user: other });
      else outgoing.push({ id: r.id, user: other });
    }
    return json(request, { friends, incoming, outgoing });
  }

  if (method === 'POST' && path === '/api/friends') {
    const user = await requireUser(env, request);
    if (user.kind !== 'user') return error(request, 'Guests cannot add friends. Create an account first.');
    const body = await request.json().catch(() => ({}));
    const username = String(body.username || '').trim().toLowerCase();
    const other = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND kind = ?').bind(username, 'user').first();
    if (!other) return error(request, 'No registered player with that username', 404);
    if (other.id === user.id) return error(request, 'You cannot add yourself');
    const existing = await env.DB.prepare(
      `SELECT * FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    )
      .bind(user.id, other.id, other.id, user.id)
      .first();
    if (existing?.status === 'accepted') return error(request, 'You are already friends', 409);
    if (existing?.status === 'pending') return error(request, 'A friend request is already pending', 409);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO friendships (id, requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, user.id, other.id, 'pending', Date.now())
      .run();
    await notifyUser(env, other.id, { type: 'FRIEND_REQUEST', from: publicUser(user) });
    return json(request, { ok: true, id });
  }

  const friendAction = path.match(/^\/api\/friends\/([^/]+)\/(accept|decline)$/);
  if (method === 'POST' && friendAction) {
    const user = await requireUser(env, request);
    const [, fid, action] = friendAction;
    const row = await env.DB.prepare('SELECT * FROM friendships WHERE id = ?').bind(fid).first();
    if (!row || row.addressee_id !== user.id) return error(request, 'Request not found', 404);
    if (action === 'accept') {
      await env.DB.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").bind(fid).run();
      await notifyUser(env, row.requester_id, { type: 'FRIEND_ACCEPTED', user: publicUser(user) });
    } else {
      await env.DB.prepare('DELETE FROM friendships WHERE id = ?').bind(fid).run();
    }
    return json(request, { ok: true });
  }

  if (method === 'GET' && path === '/api/invites') {
    const user = await requireUser(env, request);
    const rows = await env.DB.prepare(
      `SELECT i.*, u.name AS from_name, u.username AS from_username, u.kind AS from_kind
       FROM invites i JOIN users u ON u.id = i.from_id
       WHERE i.to_id = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
    )
      .bind(user.id)
      .all();
    return json(request, {
      invites: (rows.results || []).map((r) => ({
        id: r.id,
        roomCode: r.room_code,
        gameId: r.game_id,
        from: { id: r.from_id, name: r.from_name, username: r.from_username, kind: r.from_kind },
        createdAt: r.created_at,
      })),
    });
  }

  const inviteAction = path.match(/^\/api\/invites\/([^/]+)\/(accept|decline)$/);
  if (method === 'POST' && inviteAction) {
    const user = await requireUser(env, request);
    const [, iid, action] = inviteAction;
    const row = await env.DB.prepare('SELECT * FROM invites WHERE id = ? AND to_id = ?').bind(iid, user.id).first();
    if (!row) return error(request, 'Invite not found', 404);
    await env.DB.prepare('UPDATE invites SET status = ? WHERE id = ?')
      .bind(action === 'accept' ? 'accepted' : 'declined', iid)
      .run();
    return json(request, { ok: true, roomCode: row.room_code });
  }

  if (method === 'POST' && path === '/api/rooms') {
    const user = await requireUser(env, request);
    const body = await request.json().catch(() => ({}));
    const gameId = body.gameId;
    getGame(gameId);
    const code = newRoomCode();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const res = await stub.fetch('https://room/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        gameId,
        options: body.options ?? {},
        host: publicUser(user),
      }),
    });
    const room = await res.json();
    return json(request, { room });
  }

  const roomMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|start|leave|invite|snapshot))?$/);
  if (roomMatch) {
    const user = await requireUser(env, request);
    const code = roomMatch[1].toUpperCase();
    const action = roomMatch[2] || 'snapshot';
    const stub = env.ROOM.get(env.ROOM.idFromName(code));

    if (method === 'GET' && action === 'snapshot') {
      const res = await stub.fetch('https://room/snapshot');
      const room = await res.json();
      if (room.error) return error(request, room.error, res.status);
      return json(request, { room });
    }

    if (method === 'POST' && action === 'join') {
      const res = await stub.fetch('https://room/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: publicUser(user) }),
      });
      const room = await res.json();
      if (room.error) return error(request, room.error, res.status);
      return json(request, { room });
    }

    if (method === 'POST' && action === 'start') {
      const res = await stub.fetch('https://room/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const room = await res.json();
      if (room.error) return error(request, room.error, res.status);
      return json(request, { room });
    }

    if (method === 'POST' && action === 'leave') {
      const res = await stub.fetch('https://room/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const room = await res.json();
      return json(request, { room });
    }

    if (method === 'POST' && action === 'invite') {
      if (user.kind !== 'user') return error(request, 'Guests cannot invite friends. Create an account first.');
      const body = await request.json().catch(() => ({}));
      const toId = body.userId;
      const friend = await env.DB.prepare(
        `SELECT * FROM friendships
         WHERE status = 'accepted'
           AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
      )
        .bind(user.id, toId, toId, user.id)
        .first();
      if (!friend) return error(request, 'You can only invite friends');
      const snap = await stub.fetch('https://room/snapshot');
      const room = await snap.json();
      if (room.error) return error(request, room.error, snap.status);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO invites (id, from_id, to_id, room_code, game_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
        .bind(id, user.id, toId, code, room.gameId, Date.now())
        .run();
      await notifyUser(env, toId, {
        type: 'INVITE',
        id,
        roomCode: code,
        gameId: room.gameId,
        from: publicUser(user),
      });
      return json(request, { ok: true, id });
    }
  }

  if (method === 'GET' && path === '/api/health') {
    return json(request, { ok: true });
  }

  return error(request, 'Not found', 404);
}
