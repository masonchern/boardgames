import { el } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { getMe, login, register, playAsGuest, logout, rename, loadMe } from '../../core/auth.js';
import { navigate } from '../../core/router.js';
import { t, te, gameText } from '../../core/i18n.js';

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
      el('header', { class: 'page__header' }, el('h1', {}, t('account.title')), el('p', {}, t('account.blurb'))),
      me ? signedIn(me) : signedOut(),
    );
  }

  function signedOut() {
    const err = el('p', { class: 'account__msg is-error' });
    err.hidden = true;
    const userIn = el('input', {
      type: 'text',
      name: 'username',
      autocomplete: 'username',
      placeholder: t('account.placeholder.user'),
      required: true,
    });
    const passIn = el('input', {
      type: 'password',
      name: 'password',
      autocomplete: 'current-password',
      placeholder: t('account.placeholder.pass'),
      required: true,
    });
    const nameIn = el('input', { type: 'text', name: 'name', placeholder: t('account.placeholder.name') });
    const guestIn = el('input', { type: 'text', placeholder: t('account.placeholder.guest'), value: t('account.guestDefault') });

    async function run(fn) {
      if (busy) return;
      busy = true;
      err.hidden = true;
      try {
        await fn();
        render();
      } catch (e) {
        err.textContent = te(e.message);
        err.hidden = false;
      } finally {
        busy = false;
      }
    }

    return el(
      'div',
      { class: 'panel' },
      err,
      el('h3', {}, t('account.signIn')),
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
        el('button', { class: 'btn', type: 'submit' }, t('account.signIn')),
      ),
      el('h3', {}, t('account.create')),
      el('p', { class: 'muted' }, t('account.create.blurb')),
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
        el('p', { class: 'muted' }, t('account.create.usesFields')),
        el('button', { class: 'btn', type: 'submit' }, t('account.create')),
      ),
      el('h3', {}, t('account.guest')),
      el('p', { class: 'muted' }, t('account.guest.blurb')),
      el(
        'form',
        {
          class: 'account__form',
          onsubmit: (e) => {
            e.preventDefault();
            run(() => playAsGuest(guestIn.value || t('account.guestDefault')));
          },
        },
        guestIn,
        el('button', { class: 'btn btn--ghost', type: 'submit' }, t('account.guestContinue')),
      ),
    );
  }

  function signedIn(me) {
    const friendsBox = el('div', { class: 'friends' }, el('p', { class: 'muted' }, t('account.loadingFriends')));
    const invitesBox = el('div', { class: 'friends' }, el('p', { class: 'muted' }, t('account.loadingInvites')));
    loadFriends(friendsBox);
    loadInvites(invitesBox);
    const letter = (me.name || '?').slice(0, 1).toUpperCase();
    const record =
      me.kind === 'user'
        ? t('account.record', {
            wins: me.wins,
            losses: me.losses,
            winsS: me.wins === 1 ? '' : 's',
            lossesS: me.losses === 1 ? '' : 'es',
          })
        : t('account.guestRecord');

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
              const name = prompt(t('account.renamePrompt'), me.name);
              if (!name) return;
              try {
                await rename(name);
                render();
              } catch (e) {
                alert(te(e.message));
              }
            },
          },
          t('account.rename'),
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
          t('account.signOut'),
        ),
      ),
      me.kind === 'guest' && el('p', { class: 'muted' }, t('account.guestHint')),
      el('h3', {}, t('account.friends')),
      friendsBox,
      me.kind === 'user' && el('h3', {}, t('account.invites')),
      me.kind === 'user' && invitesBox,
    );
  }

  async function loadFriends(box) {
    const me = getMe();
    if (!me || me.kind !== 'user') {
      box.replaceChildren(el('p', { class: 'muted' }, t('account.friendsGuest')));
      return;
    }
    try {
      const data = await api('/api/friends');
      const addIn = el('input', { type: 'text', placeholder: t('account.addUser') });
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
                alert(te(err.message));
              }
            },
          },
          addIn,
          el('button', { class: 'btn', type: 'submit' }, t('account.addFriend')),
        ),
        data.incoming.length ? el('h4', {}, t('account.requests')) : null,
        ...data.incoming.map((r) =>
          el(
            'div',
            { class: 'friend' },
            el('span', {}, r.user.name, el('span', { class: 'muted' }, ` @${r.user.username}`)),
            el(
              'span',
              { class: 'friend__actions' },
              el('button', { class: 'btn', onclick: () => actFriend(r.id, 'accept', box) }, t('account.accept')),
              el('button', { class: 'btn btn--ghost', onclick: () => actFriend(r.id, 'decline', box) }, t('account.decline')),
            ),
          ),
        ),
        data.outgoing.length
          ? el('p', { class: 'muted' }, t('account.waitingOn', { names: data.outgoing.map((r) => r.user.username).join(', ') }))
          : null,
        data.friends.length ? el('h4', {}, t('account.yourFriends')) : el('p', { class: 'muted' }, t('account.noFriends')),
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
                    alert(te(err.message));
                  }
                },
              },
              t('account.inviteCc'),
            ),
          ),
        ),
      );
    } catch (err) {
      box.replaceChildren(banner(te(err.message), 'is-error'));
    }
  }

  async function loadInvites(box) {
    try {
      const data = await api('/api/invites');
      if (!data.invites.length) {
        box.replaceChildren(el('p', { class: 'muted' }, t('account.noInvites')));
        return;
      }
      box.replaceChildren(
        ...data.invites.map((inv) =>
          el(
            'div',
            { class: 'friend' },
            el(
              'span',
              {},
              t('account.inviteLine', {
                name: inv.from.name,
                game: gameText(inv.gameId, 'title', inv.gameId),
                code: inv.roomCode,
              }),
            ),
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
                      alert(te(err.message));
                    }
                  },
                },
                t('toast.join'),
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
                      alert(te(err.message));
                    }
                  },
                },
                t('account.decline'),
              ),
            ),
          ),
        ),
      );
    } catch (err) {
      box.replaceChildren(banner(te(err.message), 'is-error'));
    }
  }

  async function actFriend(id, action, box) {
    try {
      await api(`/api/friends/${id}/${action}`, { method: 'POST' });
      loadFriends(box);
    } catch (err) {
      alert(te(err.message));
    }
  }

  refresh();
  return root;
}
