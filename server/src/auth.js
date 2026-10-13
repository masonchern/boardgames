const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERS = 100_000;

const bytesToHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

export const publicUser = (row) =>
  row && {
    id: row.id,
    username: row.username,
    name: row.name,
    kind: row.kind,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
  };

export async function hashPassword(password, saltBytes) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    key,
    256,
  );
  return bytesToHex(bits);
}

export async function makePassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  return { salt: bytesToHex(salt), hash };
}

export async function checkPassword(password, saltHex, hashHex) {
  const got = await hashPassword(password, hexToBytes(saltHex));
  return got === hashHex;
}

export function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const url = new URL(request.url);
  return url.searchParams.get('token') || '';
}

export async function getSessionUser(env, request) {
  const token = bearer(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
  )
    .bind(token, Date.now())
    .first();
  if (row) {
    env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), row.id).run();
  }
  return row;
}

export async function requireUser(env, request) {
  const user = await getSessionUser(env, request);
  if (!user) {
    const err = new Error('Sign in first');
    err.status = 401;
    throw err;
  }
  return user;
}

export async function createSession(env, userId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, userId, now, now + SESSION_MS)
    .run();
  return token;
}

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,15}$/;

export function normalizeUsername(raw) {
  const username = String(raw || '').trim();
  if (!USERNAME_RE.test(username)) {
    throw Object.assign(new Error('Username: 3–16 letters, numbers or _, starting with a letter'), { status: 400 });
  }
  return username.toLowerCase();
}

export function normalizeName(raw, fallback = 'Guest') {
  const name = String(raw || fallback).trim().slice(0, 24);
  return name || fallback;
}

export async function createGuest(env, name) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO users (id, username, name, kind, created_at, last_seen) VALUES (?, NULL, ?, ?, ?, ?)',
  )
    .bind(id, normalizeName(name, 'Guest'), 'guest', now, now)
    .run();
  const token = await createSession(env, id);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return { token, user: publicUser(user) };
}
