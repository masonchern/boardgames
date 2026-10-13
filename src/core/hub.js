import { getToken, onAuth } from './auth.js';
import { wsUrl } from './config.js';

/**
 * Keep a WebSocket to the presence hub while the player is signed in.
 * Pushes friend requests and room invites to the callbacks.
 */
export function startHub({ onMessage } = {}) {
  let ws = null;
  let stopped = false;
  let retry = 0;

  function connect() {
    const token = getToken();
    if (stopped || !token) return;
    try {
      ws = new WebSocket(`${wsUrl('/ws/hub')}?token=${encodeURIComponent(token)}`);
    } catch {
      schedule();
      return;
    }
    ws.onmessage = (e) => {
      try {
        onMessage?.(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    ws.onopen = () => {
      retry = 0;
    };
    ws.onclose = () => {
      ws = null;
      if (!stopped && getToken()) schedule();
    };
  }

  function schedule() {
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 1000 * retry);
  }

  const unsub = onAuth((user) => {
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    if (user) {
      retry = 0;
      connect();
    }
  });

  connect();
  return () => {
    stopped = true;
    unsub();
    ws?.close();
  };
}
