/* global __API_URL__ */

/** Base URL of the Cloudflare Worker (no trailing slash). */
export function apiUrl() {
  const raw = typeof __API_URL__ === 'string' ? __API_URL__ : 'http://localhost:8787';
  return raw.replace(/\/$/, '');
}

/** WebSocket URL for a Worker path like `/ws/hub`. */
export function wsUrl(path) {
  const url = new URL(path, apiUrl());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
