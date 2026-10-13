import { el } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { ensureSession, getMe, getToken } from '../../core/auth.js';
import { navigate } from '../../core/router.js';
import { getManifest } from '../../core/registry.js';
import { mountGame, WebSocketTransport } from '../../core/gameLoader.js';
import { wsUrl } from '../../core/config.js';
import { t, te, gameText, onLang } from '../../core/i18n.js';

/**
 * Online room: waiting lobby, then the live match on the same page.
 */
export function renderRoomPage(code) {
  const codeNorm = (code || '').toUpperCase();
  const stage = el('div', { class: 'game-stage' });
  const title = el('div', { class: 'game-bar__title' }, `Room ${codeNorm}`);
  const backBtn = el('button', { class: 'btn btn--ghost', onclick: () => navigate('games') }, t('back.lobby'));
  const awayBar = el('div', { class: 'away-banner' });
  awayBar.hidden = true;
  const node = el(
    'section',
    { class: 'page page--game page--wide' },
    el('header', { class: 'game-bar' }, backBtn, title, el('div', { class: 'game-bar__spacer' })),
    awayBar,
    stage,
  );

  let destroyed = false;
  let handle = null;
  let transport = null;
  let poll = null;
  let awayTick = null;
  let room = null;
  let showingLobby = false;

  const joinUrl = () => {
    const url = new URL(location.href);
    url.hash = `#/join/${codeNorm}`;
    return url.toString();
  };

  function gameTitle() {
    if (!room) return codeNorm;
    const manifest = getManifest(room.gameId);
    return gameText(room.gameId, 'title', manifest?.title ?? room.gameId);
  }

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
      stage.replaceChildren(placeholder('⚠️', t('room.joinFail'), te(err.message)));
    }
  }

  function showLobby(r) {
    room = r;
    showingLobby = true;
    title.textContent = `${gameTitle()} · ${r.code}`;
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
            el('div', { class: 'seat__label' }, i === 0 ? t('room.host') : t('room.seat2')),
            el('div', { class: 'seat__name' }, s ? s.name : t('room.waiting')),
            s?.kind === 'guest' && el('span', { class: 'muted' }, t('room.guest')),
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
            copyBtn.textContent = t('room.copied');
            setTimeout(() => (copyBtn.textContent = t('room.copy')), 1500);
          } catch {
            prompt(t('room.copy'), joinUrl());
          }
        },
      },
      t('room.copy'),
    );

    const startBtn = el(
      'button',
      {
        class: 'btn',
        disabled: room.seats.length < 2 || !isHost,
        onclick: () => transport?.startGame(),
      },
      isHost ? t('room.start') : t('room.waitHost'),
    );

    stage.replaceChildren(
      el(
        'div',
        { class: 'room' },
        el('p', { class: 'muted' }, t('room.share')),
        el('div', { class: 'room__code' }, room.code),
        el('div', { class: 'row-actions' }, copyBtn),
        seats,
        startBtn,
        el('h3', {}, t('room.inviteFriend')),
        friendsBox,
      ),
    );
    loadFriends(friendsBox, isHost);
    startBtn.disabled = room.seats.length < 2 || !isHost;
  }

  async function loadFriends(box, isHost) {
    const me = getMe();
    if (!me || me.kind !== 'user') {
      box.replaceChildren(el('p', { class: 'muted' }, t('room.inviteFriendsHint')));
      return;
    }
    try {
      const data = await api('/api/friends');
      if (!data.friends.length) {
        box.replaceChildren(el('p', { class: 'muted' }, t('room.noFriends')));
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
              el('span', { class: 'muted' }, ` ${f.user.online ? t('online') : t('offline')}`),
            ),
            el(
              'button',
              {
                class: 'btn btn--ghost',
                disabled: !isHost,
                onclick: async () => {
                  try {
                    await api(`/api/rooms/${codeNorm}/invite`, { method: 'POST', body: { userId: f.user.id } });
                    alert(t('room.inviteSent', { name: f.user.name }));
                  } catch (err) {
                    alert(te(err.message));
                  }
                },
              },
              t('room.invite'),
            ),
          ),
        ),
      );
    } catch (err) {
      box.replaceChildren(el('p', { class: 'muted' }, te(err.message)));
    }
  }

  function renderAway() {
    const me = getMe();
    const away = room?.away;
    if (!away || room.phase !== 'playing' || room.gameOver || away.userId === me?.id) {
      awayBar.hidden = true;
      return;
    }
    const name = room.seats.find((s) => s.id === away.userId)?.name ?? t('away.opponent');
    const waitMs = away.waitMs ?? 120000;
    const left = Math.max(0, Math.ceil((away.since + waitMs - Date.now()) / 1000));
    const canClaim = left === 0;
    awayBar.hidden = false;
    awayBar.replaceChildren(
      el('p', {}, canClaim ? t('away.ready', { name }) : t('away.wait', { name, n: left })),
      el(
        'button',
        {
          class: 'btn',
          disabled: !canClaim,
          onclick: () => transport?.claimDisconnect(),
        },
        t('away.kick'),
      ),
    );
  }

  function onRoomUpdate(next) {
    if (destroyed || !next) return;
    room = next;
    renderAway();
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
            el('div', { class: 'seat__label' }, i === 0 ? t('room.host') : t('room.seat2')),
            el('div', { class: 'seat__name' }, s ? s.name : t('room.waiting')),
            s?.kind === 'guest' && el('span', { class: 'muted' }, t('room.guest')),
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
          if (msg) msg.textContent = te(err.message);
        }
      },
    });
  }

  function startMatch(r) {
    if (handle || destroyed) return;
    room = r;
    showingLobby = false;
    const me = getMe();
    title.textContent = gameTitle();
    if (poll) clearInterval(poll);
    if (!awayTick) awayTick = setInterval(renderAway, 500);
    renderAway();
    const loading = placeholder('⏳', t('room.starting'), '');
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
        stage.replaceChildren(placeholder('⚠️', t('room.loadFail'), err.message));
      });
  }

  const stopLang = onLang(() => {
    backBtn.textContent = t('back.lobby');
    if (showingLobby && room) showLobby(room);
    else {
      if (room) title.textContent = gameTitle();
      renderAway();
    }
  });

  boot();

  return {
    node,
    destroy() {
      destroyed = true;
      stopLang();
      if (poll) clearInterval(poll);
      if (awayTick) clearInterval(awayTick);
      handle?.destroy();
      if (!handle) transport?.close();
    },
  };
}
