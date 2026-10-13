/**
 * One global Durable Object: presence + push (friend invites, room invites).
 * Logged-in browsers keep a WebSocket here while the site is open.
 */
export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/notify' && request.method === 'POST') {
      const { userId, payload } = await request.json();
      this.sendTo(userId, payload);
      return Response.json({ ok: true, online: this.isOnline(userId) });
    }

    if (url.pathname === '/online' && request.method === 'POST') {
      const { userIds } = await request.json();
      const online = {};
      for (const id of userIds || []) online[id] = this.isOnline(id);
      return Response.json({ online });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const userId = url.searchParams.get('userId');
    if (!userId) return new Response('Missing user', { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId });
    return new Response(null, { status: 101, webSocket: client });
  }

  isOnline(userId) {
    return this.socketsFor(userId).length > 0;
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

  sendTo(userId, payload) {
    const body = JSON.stringify(payload);
    for (const ws of this.socketsFor(userId)) {
      try {
        ws.send(body);
      } catch {
        // socket already closing
      }
    }
  }

  async webSocketMessage() {
    // Presence only; the client does not send app messages on this socket.
  }

  async webSocketClose() {}
  async webSocketError() {}
}

export function hubStub(env) {
  return env.HUB.get(env.HUB.idFromName('global'));
}

export async function notifyUser(env, userId, payload) {
  const res = await hubStub(env).fetch('https://hub/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, payload }),
  });
  return res.json();
}

export async function whoIsOnline(env, userIds) {
  const res = await hubStub(env).fetch('https://hub/online', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds }),
  });
  const data = await res.json();
  return data.online || {};
}
