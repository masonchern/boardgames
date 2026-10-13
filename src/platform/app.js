import { el } from '../core/dom.js';
import { buildLabel } from '../core/buildInfo.js';
import { startUpdateCheck } from '../core/updateCheck.js';
import { navigate, startRouter } from '../core/router.js';
import { loadMe, onAuth } from '../core/auth.js';
import { startHub } from '../core/hub.js';
import { renderLobby } from './pages/lobby.js';
import { renderGamePage } from './pages/gamePage.js';
import { renderAccount } from './pages/account.js';
import { renderSettings } from './pages/settings.js';
import { renderRoomPage } from './pages/room.js';
import { renderJoinPage } from './pages/join.js';

/** Sidebar tabs. Add a page by adding an entry here and a case in `renderRoute`. */
const TABS = [
  { id: 'games', label: 'Games', icon: '🎮' },
  { id: 'account', label: 'Account', icon: '👤' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export function createApp(root) {
  const pageSlot = el('div', { class: 'content__page' });
  const buildStamp = el('footer', { class: 'build-info' }, buildLabel());
  const content = el('main', { class: 'content' }, pageSlot, buildStamp);
  const navButtons = new Map();
  const sidebarWho = el('div', { class: 'sidebar__footer muted' }, 'Not signed in');

  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    el('div', { class: 'brand' }, el('span', { class: 'brand__logo' }, '♟'), el('span', {}, 'Boardgames Hub')),
    el(
      'nav',
      { class: 'nav' },
      TABS.map((tab) => {
        const btn = el(
          'button',
          { class: 'nav__item', onclick: () => navigate(tab.id) },
          el('span', { class: 'nav__icon' }, tab.icon),
          el('span', {}, tab.label),
        );
        navButtons.set(tab.id, btn);
        return btn;
      }),
    ),
    sidebarWho,
  );

  const shell = el('div', { class: 'shell' }, sidebar, content);
  root.append(shell);
  startUpdateCheck();
  loadMe();
  onAuth((user) => {
    sidebarWho.textContent = user ? `${user.name}${user.kind === 'guest' ? ' (guest)' : ''}` : 'Not signed in';
  });
  startHub({ onMessage: handlePush });

  let teardown = null;

  function handlePush(msg) {
    if (msg.type === 'INVITE') showInvite(msg);
    else if (msg.type === 'FRIEND_REQUEST') showFriendReq(msg);
  }

  function showInvite(msg) {
    document.querySelector('.invite-toast')?.remove();
    const toast = el(
      'div',
      { class: 'invite-toast', role: 'status' },
      el('span', {}, `${msg.from?.name ?? 'A friend'} invited you to ${msg.gameId === 'close-circuit' ? 'Close Circuit' : msg.gameId}.`),
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            toast.remove();
            navigate(`room/${msg.roomCode}`);
          },
        },
        'Join',
      ),
      el('button', { class: 'btn btn--ghost', onclick: () => toast.remove() }, 'Later'),
    );
    document.body.append(toast);
  }

  function showFriendReq(msg) {
    document.querySelector('.invite-toast')?.remove();
    const toast = el(
      'div',
      { class: 'invite-toast', role: 'status' },
      el('span', {}, `${msg.from?.name ?? 'Someone'} sent you a friend request.`),
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            toast.remove();
            navigate('account');
          },
        },
        'View',
      ),
      el('button', { class: 'btn btn--ghost', onclick: () => toast.remove() }, 'Later'),
    );
    document.body.append(toast);
  }

  function renderRoute(route) {
    const { tab, gameId, roomCode, joinCode } = route;
    teardown?.();
    teardown = null;

    navButtons.forEach((btn, id) => btn.classList.toggle('is-active', id === tab));
    const inGame = (tab === 'games' && Boolean(gameId)) || tab === 'room';
    shell.classList.toggle('is-in-game', inGame);

    let node;
    if (tab === 'room' && roomCode) {
      const page = renderRoomPage(roomCode);
      node = page.node;
      teardown = page.destroy;
    } else if (tab === 'join') node = renderJoinPage(joinCode);
    else if (tab === 'games' && gameId) {
      const page = renderGamePage(gameId);
      node = page.node;
      teardown = page.destroy;
    } else if (tab === 'account') node = renderAccount();
    else if (tab === 'settings') node = renderSettings();
    else node = renderLobby();

    node.classList.add('page-enter');
    pageSlot.replaceChildren(node);
  }

  startRouter(renderRoute);
}
