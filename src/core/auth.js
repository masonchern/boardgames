import { api } from './api.js';

const TOKEN_KEY = 'bg_token';
const listeners = new Set();
/** @type {null | {id:string, name:string, username?:string, kind:string, wins:number, losses:number}} */
let me = null;

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getMe = () => me;

function emit() {
  listeners.forEach((fn) => fn(me));
}

export function onAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setSession(token, user) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  me = user;
  emit();
  return user;
}

export async function loadMe() {
  if (!getToken()) {
    me = null;
    return null;
  }
  try {
    const data = await api('/api/me');
    me = data.user;
    emit();
    return me;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    me = null;
    emit();
    return null;
  }
}

export async function register({ username, password, name }) {
  const data = await api('/api/register', { method: 'POST', body: { username, password, name }, auth: false });
  return setSession(data.token, data.user);
}

export async function login({ username, password }) {
  const data = await api('/api/login', { method: 'POST', body: { username, password }, auth: false });
  return setSession(data.token, data.user);
}

export async function playAsGuest(name = 'Guest') {
  const data = await api('/api/guest', { method: 'POST', body: { name }, auth: false });
  return setSession(data.token, data.user);
}

/** Use the current session, or create a guest so online play can start. */
export async function ensureSession() {
  if (me) return me;
  const existing = await loadMe();
  if (existing) return existing;
  return playAsGuest('Guest');
}

export async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* still clear locally */
  }
  return setSession(null, null);
}

export async function rename(name) {
  const data = await api('/api/me/name', { method: 'POST', body: { name } });
  me = data.user;
  emit();
  return me;
}
