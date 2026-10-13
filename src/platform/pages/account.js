import { el } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { getMe, login, register, playAsGuest, logout, rename, loadMe } from '../../core/auth.js';
import { navigate } from '../../core/router.js';

export function renderAccount() {
  const root = el('section', { class: 'page' });
  let busy = false;

  async function refresh() {
    try {
      await loadMe();
    } catch {
      /* shown as signed out */
    }
    render();
  }

  function banner(text, kind = '') {
    return text ? el('p', { class: `account__msg ${kind}` }, text) : null;
  }

  function render() {
    const me = getMe();
    root.replaceChildren(
      el('header', { class: 'page__header' }, el('h1', {}, 'Account'), el('p', {}, 'Profile, friends, and win record.')),
      me ? signedIn(me) : signedOut(),
    );
  }

  function signedOut() {
    const err = el('p', { class: 'account__msg is-error' });
    err.hidden = true;
    const userIn = el('input', { type: 'text', name: 'username', autocomplete: 'username', placeholder: 'username', required: true });
    const passIn = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'password', required: true });
    const nameIn = el('input', { type: 'text', name: 'name', placeholder: 'Display name (optional)' });
    const guestIn = el('input', { type: 'text', placeholder: 'Guest name', value: 'Guest' });

    async function run(fn) {
      if (busy) return;
      busy = true;
      err.hidden = true;
      try {
        await fn();
        render();
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      } finally {
        busy = false;
      }
    }

    return el(
      'div',
      { class: 'panel' },
      err,
      el('h3', {}, 'Sign in'),
      el(
        'form',
        {
          class: 'account__form',
          onsubmit: (e) => {
            e.preventDefault();
            run(() => login({ username: userIn.value, password: passIn.value }));
          },
        },
        userIn,
        passIn,
        el('button', { class: 'btn', type: 'submit' }, 'Sign in'),
      ),
      el('h3', {}, 'Create account'),
      el('p', { class: 'muted' }, 'Username and password. Wins and losses against other registered players are saved. No email needed.'),
      el(
        'form',
        {
          class: 'account__form',
          onsubmit: (e) => {
            e.preventDefault();
            run(() =>
              register({
                username: userIn.value,
                password: passIn.value,
                name: nameIn.value || userIn.value,
              }),
            );
          },
        },
        nameIn,
        el('p', { class: 'muted' }, 'Uses the username and password fields above.'),
        el('button', { class: 'btn', type: 'submit' }, 'Create account'),
      ),
      el('h3', {}, 'Play as guest'),
      el('p', { class: 'muted' }, 'No record is kept. You can still join rooms with a code.'),
      el(
        'form',
        {
          class: 'account__form',
          onsubmit: (e) => {
            e.preventDefault();
            run(() => playAsGuest(guestIn.value || 'Guest'));
          },
        },
        guestIn,
        el('button', { class: 'btn btn--ghost', type: 'submit' }, 'Continue as guest'),
      ),
    );
  }

  function signedIn(me) {
    const friendsBox = el('div', { class: 'friends' }, el('p', { class: 'muted' }, 'Loading friends…'));
    const invitesBox = el('div', { class: 'friends' }, el('p', { class: 'muted' }, 'Loading invites…'));
    loadFriends(friendsBox);
    loadInvites(invitesBox);
    const letter = (me.name || '?').slice(0, 1).toUpperCase();
    const record =
      me.kind === 'user'
        ? `${me.wins} win${me.wins === 1 ? '' : 's'} · ${me.losses} loss${me.losses === 1 ? '' : 'es'}`
        : 'Guest · games are not recorded';

    return el(
      'div',
      { class: 'panel' },
      el(
        'div',
        { class: 'profile' },
        el('div', { class: 'avatar' }, letter),
        el(
          'div',
          {},
          el('h3', {}, me.name),
          me.username && el('p', { class: 'muted' }, `@${me.username}`),
          el('p', { class: 'muted' }, record),
        ),
      ),
      el(
        'div',
        { class: 'row-actions' },
        el(
          'button',
          {
            class: 'btn btn--ghost',
            onclick: async () => {
              const name = prompt('Display name', me.name);
              if (!name) return;
              try {
                await rename(name);
                render();
              } catch (e) {
                alert(e.message);
              }
            },
          },
          'Rename',
        ),
        el(
          'button',
          {
            class: 'btn btn--ghost',
            onclick: async () => {
              await logout();
              render();
            },
          },
          'Sign out',
        ),
      ),
      me.kind === 'guest' &&
        el('p', { class: 'muted' }, 'Create an account (sign out first, then use Create account) if you want wins recorded and a friends list.'),
      el('h3', {}, 'Friends'),
      friendsBox,
      me.kind === 'user' && el('h3', {}, 'Game invites'),
      me.kind === 'user' && invitesBox,
    );
  }

  async function loadFriends(box) {
    const me = getMe();
    if (!me || me.kind !== 'user') {
      box.replaceChildren(el('p', { class: 'muted' }, 'Friends are for registered accounts.'));
      return;
    }
    try {
      const data = await api('/api/friends');
      const addIn = el('input', { type: 'text', placeholder: 'Add by username' });
      box.replaceChildren(
        el(
          'form',
          {
            class: 'account__form',
            onsubmit: async (e) => {
              e.preventDefault();
              try {
                await api('/api/friends', { method: 'POST', body: { username: addIn.value } });
                addIn.value = '';
                loadFriends(box);
              } catch (err) {
                alert(err.message);
              }
            },
          },
          addIn,
          el('button', { class: 'btn', type: 'submit' }, 'Add friend'),
        ),
        data.incoming.length ? el('h4', {}, 'Requests') : null,
        ...data.incoming.map((r) =>
          el(
            'div',
            { class: 'friend' },
            el('span', {}, r.user.name, el('span', { class: 'muted' }, ` @${r.user.username}`)),
            el(
              'span',
              { class: 'friend__actions' },
              el('button', { class: 'btn', onclick: () => actFriend(r.id, 'accept', box) }, 'Accept'),
              el('button', { class: 'btn btn--ghost', onclick: () => actFriend(r.id, 'decline', box) }, 'Decline'),
            ),
          ),
        ),
        data.outgoing.length ? el('p', { class: 'muted' }, `Waiting on: ${data.outgoing.map((r) => r.user.username).join(', ')}`) : null,
        data.friends.length ? el('h4', {}, 'Your friends') : el('p', { class: 'muted' }, 'No friends yet. Add someone by username.'),
        ...data.friends.map((r) =>
          el(
            'div',
            { class: 'friend' },
            el(
              'span',
              {},
              el('span', { class: `dot ${r.user.online ? 'is-on' : ''}` }),
              r.user.name,
              el('span', { class: 'muted' }, ` @${r.user.username} · ${r.user.wins}–${r.user.losses}`),
            ),
            el(
              'button',
              {
                class: 'btn btn--ghost',
                onclick: async () => {
                  try {
                    const created = await api('/api/rooms', { method: 'POST', body: { gameId: 'close-circuit', options: {} } });
                    await api(`/api/rooms/${created.room.code}/invite`, { method: 'POST', body: { userId: r.user.id } });
                    navigate(`room/${created.room.code}`);
                  } catch (err) {
                    alert(err.message);
                  }
                },
              },
              'Invite to Close Circuit',
            ),
          ),
        ),
      );
    } catch (err) {
      box.replaceChildren(banner(err.message, 'is-error'));
    }
  }

  async function loadInvites(box) {
    try {
      const data = await api('/api/invites');
      if (!data.invites.length) {
        box.replaceChildren(el('p', { class: 'muted' }, 'No pending invites.'));
        return;
      }
      box.replaceChildren(
        ...data.invites.map((inv) =>
          el(
            'div',
            { class: 'friend' },
            el('span', {}, `${inv.from.name} invited you to ${inv.gameId === 'close-circuit' ? 'Close Circuit' : inv.gameId} · ${inv.roomCode}`),
            el(
              'span',
              { class: 'friend__actions' },
              el(
                'button',
                {
                  class: 'btn',
                  onclick: async () => {
                    try {
                      await api(`/api/invites/${inv.id}/accept`, { method: 'POST' });
                      navigate(`room/${inv.roomCode}`);
                    } catch (err) {
                      alert(err.message);
                    }
                  },
                },
                'Join',
              ),
              el(
                'button',
                {
                  class: 'btn btn--ghost',
                  onclick: async () => {
                    try {
                      await api(`/api/invites/${inv.id}/decline`, { method: 'POST' });
                      loadInvites(box);
                    } catch (err) {
                      alert(err.message);
                    }
                  },
                },
                'Decline',
              ),
            ),
          ),
        ),
      );
    } catch (err) {
      box.replaceChildren(banner(err.message, 'is-error'));
    }
  }

  async function actFriend(id, action, box) {
    try {
      await api(`/api/friends/${id}/${action}`, { method: 'POST' });
      loadFriends(box);
    } catch (err) {
      alert(err.message);
    }
  }

  refresh();
  return root;
}
