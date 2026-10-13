import { el } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ensureSession, getMe, getToken } from '../../core/auth.js';
import { navigate } from '../../core/router.js';
import { getManifest } from '../../core/registry.js';
import { mountGame, WebSocketTransport } from '../../core/gameLoader.js';
import { wsUrl } from '../../core/config.js';

/**
 * Online room: waiting lobby, then the live match on the same page.
 */
export function renderRoomPage(code) {
  const codeNorm = (code || '').toUpperCase();
  const stage = el('div', { class: 'game-stage' });
  const title = el('div', { class: 'game-bar__title' }, `Room ${codeNorm}`);
  const node = el(
    'section',
    { class: 'page page--game page--wide' },
    el(
      'header',
      { class: 'game-bar' },
      el('button', { class: 'btn btn--ghost', onclick: () => navigate('games') }, '← Back to lobby'),
      title,
      el('div', { class: 'game-bar__spacer' }),
    ),
    stage,
  );

  let destroyed = false;
  let handle = null;
  let transport = null;
  let poll = null;
  let room = null;

  const joinUrl = () => {
    const url = new URL(location.href);
    url.hash = `#/join/${codeNorm}`;
    return url.toString();
  };

  function placeholder(icon, heading, text) {
    return el(
      'div',
      { class: 'empty' },
      el('div', { class: 'empty__icon' }, icon),
      el('h2', {}, heading),
      text && el('p', {}, text),
    );
  }

  async function boot() {
    try {
      await ensureSession();
      const data = await api(`/api/rooms/${codeNorm}/join`, { method: 'POST' });
      room = data.room;
      if (destroyed) return;
      openSocket();
      if (room.phase === 'playing') startMatch(room);
      else showLobby(room);
    } catch (err) {
      stage.replaceChildren(placeholder('⚠️', 'Cannot join room', err.message));
    }
  }

  function showLobby(r) {
    room = r;
    const manifest = getManifest(r.gameId);
    title.textContent = `${manifest?.title ?? r.gameId} · ${r.code}`;
    const seats = el('div', { class: 'seats' });
    const friendsBox = el('div', { class: 'friends' });
    const hostId = r.hostId;
    const me = getMe();
    const isHost = me && me.id === hostId;

    function drawSeats() {
      seats.replaceChildren(
        ...[0, 1].map((i) => {
          const s = room.seats[i];
          return el(
            'div',
            { class: `seat ${s ? 'is-filled' : ''}` },
            el('div', { class: 'seat__label' }, i === 0 ? 'Host' : 'Seat 2'),
            el('div', { class: 'seat__name' }, s ? s.name : 'Waiting…'),
            s?.kind === 'guest' && el('span', { class: 'muted' }, 'guest'),
          );
        }),
      );
    }
    drawSeats();

    const copyBtn = el(
      'button',
      {
        class: 'btn btn--ghost',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(joinUrl());
            copyBtn.textContent = 'Copied';
            setTimeout(() => (copyBtn.textContent = 'Copy invite link'), 1500);
          } catch {
            prompt('Copy this link', joinUrl());
          }
        },
      },
      'Copy invite link',
    );

    const startBtn = el(
      'button',
      {
        class: 'btn',
        disabled: room.seats.length < 2 || !isHost,
        onclick: () => transport?.startGame(),
      },
      isHost ? 'Start game' : 'Waiting for the host',
    );

    stage.replaceChildren(
      el(
        'div',
        { class: 'room' },
        el('p', { class: 'muted' }, 'Share the code or link. Anyone (including guests) can join. Friends can be invited below.'),
        el('div', { class: 'room__code' }, room.code),
        el('div', { class: 'row-actions' }, copyBtn),
        seats,
        startBtn,
        el('h3', {}, 'Invite a friend'),
        friendsBox,
      ),
    );
    loadFriends(friendsBox, isHost);
    startBtn.disabled = room.seats.length < 2 || !isHost;
  }

  async function loadFriends(box, isHost) {
    const me = getMe();
    if (!me || me.kind !== 'user') {
      box.replaceChildren(el('p', { class: 'muted' }, 'Sign in with an account to invite friends. Guests can still share the code.'));
      return;
    }
    try {
      const data = await api('/api/friends');
      if (!data.friends.length) {
        box.replaceChildren(el('p', { class: 'muted' }, 'No friends yet. Add someone on the Account tab.'));
        return;
      }
      box.replaceChildren(
        ...data.friends.map((f) =>
          el(
            'div',
            { class: 'friend' },
            el(
              'span',
              {},
              el('span', { class: `dot ${f.user.online ? 'is-on' : ''}` }),
              f.user.name,
              el('span', { class: 'muted' }, f.user.online ? ' online' : ' offline'),
            ),
            el(
              'button',
              {
                class: 'btn btn--ghost',
                disabled: !isHost,
                onclick: async () => {
                  try {
                    await api(`/api/rooms/${codeNorm}/invite`, { method: 'POST', body: { userId: f.user.id } });
                    alert(`Invite sent to ${f.user.name}`);
                  } catch (err) {
                    alert(err.message);
                  }
                },
              },
              'Invite',
            ),
          ),
        ),
      );
    } catch (err) {
      box.replaceChildren(el('p', { class: 'muted' }, err.message));
    }
  }

  function onRoomUpdate(next) {
    if (destroyed || !next) return;
    room = next;
    if (next.phase === 'playing') {
      if (!handle) startMatch(next);
      return;
    }
    const startBtn = stage.querySelector('.room .btn:not(.btn--ghost)');
    const me = getMe();
    if (startBtn) startBtn.disabled = next.seats.length < 2 || me?.id !== next.hostId;
    const seats = stage.querySelector('.seats');
    if (seats) {
      seats.replaceChildren(
        ...[0, 1].map((i) => {
          const s = next.seats[i];
          return el(
            'div',
            { class: `seat ${s ? 'is-filled' : ''}` },
            el('div', { class: 'seat__label' }, i === 0 ? 'Host' : 'Seat 2'),
            el('div', { class: 'seat__name' }, s ? s.name : 'Waiting…'),
            s?.kind === 'guest' && el('span', { class: 'muted' }, 'guest'),
          );
        }),
      );
    }
  }

  function openSocket() {
    const token = getToken();
    transport = new WebSocketTransport(`${wsUrl(`/ws/room/${codeNorm}`)}?token=${encodeURIComponent(token)}`);
    transport.onRoom(onRoomUpdate);
    transport.connect({
      onState: () => {},
      onError: (err) => {
        if (room?.phase !== 'playing') {
          const msg = stage.querySelector('.room p.muted');
          if (msg) msg.textContent = err.message;
        }
      },
    });
  }

  function startMatch(r) {
    if (handle || destroyed) return;
    room = r;
    const me = getMe();
    const manifest = getManifest(r.gameId);
    title.textContent = manifest?.title ?? r.gameId;
    if (poll) clearInterval(poll);
    const loading = placeholder('⏳', 'Starting…', '');
    const gameRoot = el('div', { class: 'game-root' });
    stage.replaceChildren(loading, gameRoot);
    mountGame(r.gameId, gameRoot, {
      exit: () => navigate('games'),
      options: r.options,
      mode: 'online',
      localPlayerId: me.id,
      players: r.seats.map((s) => ({ id: s.id, name: s.name })),
      transport,
    })
      .then((h) => {
        loading.remove();
        if (destroyed) h.destroy();
        else handle = h;
      })
      .catch((err) => {
        stage.replaceChildren(placeholder('⚠️', 'Failed to load game', err.message));
      });
  }

  boot();

  return {
    node,
    destroy() {
      destroyed = true;
      if (poll) clearInterval(poll);
      handle?.destroy();
      if (!handle) transport?.close();
    },
  };
}
