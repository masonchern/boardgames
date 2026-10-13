import { el } from '../core/dom.js';
import { buildLabel } from '../core/buildInfo.js';
import { startUpdateCheck } from '../core/updateCheck.js';
import { navigate, startRouter } from '../core/router.js';
import { loadMe, onAuth } from '../core/auth.js';
import { startHub } from '../core/hub.js';
import { LANGS, getLang, setLang, onLang, t, gameText } from '../core/i18n.js';
import { renderLobby } from './pages/lobby.js';
import { renderGamePage } from './pages/gamePage.js';
import { renderAccount } from './pages/account.js';
import { renderSettings } from './pages/settings.js';
import { renderRoomPage } from './pages/room.js';
import { renderJoinPage } from './pages/join.js';

/** Sidebar tabs. Add a page by adding an entry here and a case in `renderRoute`. */
const TABS = [
  { id: 'games', icon: '🎮' },
  { id: 'account', icon: '👤' },
  { id: 'settings', icon: '⚙️' },
];

export function createApp(root) {
  const pageSlot = el('div', { class: 'content__page' });
  const buildStamp = el('footer', { class: 'build-info' }, buildLabel());
  const content = el('main', { class: 'content' }, pageSlot, buildStamp);
  const navButtons = new Map();
  const navLabels = new Map();
  const sidebarWho = el('div', { class: 'sidebar__footer muted' }, t('who.signedOut'));
  const brandName = el('span', {}, t('app.brand'));

  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    el('div', { class: 'brand' }, el('span', { class: 'brand__logo' }, '♟'), brandName),
    el(
      'nav',
      { class: 'nav' },
      TABS.map((tab) => {
        const label = el('span', {}, t(`nav.${tab.id}`));
        const btn = el(
          'button',
          { class: 'nav__item', onclick: () => navigate(tab.id) },
          el('span', { class: 'nav__icon' }, tab.icon),
          label,
        );
        navButtons.set(tab.id, btn);
        navLabels.set(tab.id, label);
        return btn;
      }),
    ),
    sidebarWho,
  );

  const langSwitch = el(
    'div',
    { class: 'lang-switch', role: 'group', 'aria-label': t('lang.label') },
    LANGS.map((L) =>
      el(
        'button',
        {
          type: 'button',
          class: `lang-switch__btn${getLang() === L.id ? ' is-active' : ''}`,
          'data-lang': L.id,
          'aria-pressed': String(getLang() === L.id),
          onclick: () => setLang(L.id),
        },
        L.label,
      ),
    ),
  );
  const topbar = el('div', { class: 'topbar' }, langSwitch);
  const shell = el('div', { class: 'shell' }, topbar, sidebar, content);
  root.append(shell);
  startUpdateCheck();
  loadMe();

  let currentUser = null;
  let lastRoute = null;
  let teardown = null;

  function whoText(user) {
    if (!user) return t('who.signedOut');
    return user.kind === 'guest' ? t('who.guest', { name: user.name }) : user.name;
  }

  function paintChrome() {
    brandName.textContent = t('app.brand');
    navLabels.forEach((span, id) => {
      span.textContent = t(`nav.${id}`);
    });
    langSwitch.setAttribute('aria-label', t('lang.label'));
    for (const btn of langSwitch.children) {
      const id = btn.getAttribute('data-lang');
      const on = id === getLang();
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    sidebarWho.textContent = whoText(currentUser);
    buildStamp.textContent = buildLabel();
  }

  onAuth((user) => {
    currentUser = user;
    sidebarWho.textContent = whoText(user);
  });
  onLang(() => {
    paintChrome();
    const live = lastRoute && ((lastRoute.tab === 'games' && lastRoute.gameId) || lastRoute.tab === 'room');
    if (lastRoute && !live) renderRoute(lastRoute);
  });
  startHub({ onMessage: handlePush });

  function handlePush(msg) {
    if (msg.type === 'INVITE') showInvite(msg);
    else if (msg.type === 'FRIEND_REQUEST') showFriendReq(msg);
  }

  function showInvite(msg) {
    document.querySelector('.invite-toast')?.remove();
    const gameName = gameText(msg.gameId, 'title', msg.gameId === 'close-circuit' ? 'Close Circuit' : msg.gameId);
    const toast = el(
      'div',
      { class: 'invite-toast', role: 'status' },
      el('span', {}, t('toast.invite', { name: msg.from?.name ?? t('toast.aFriend'), game: gameName })),
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            toast.remove();
            navigate(`room/${msg.roomCode}`);
          },
        },
        t('toast.join'),
      ),
      el('button', { class: 'btn btn--ghost', onclick: () => toast.remove() }, t('toast.later')),
    );
    document.body.append(toast);
  }

  function showFriendReq(msg) {
    document.querySelector('.invite-toast')?.remove();
    const toast = el(
      'div',
      { class: 'invite-toast', role: 'status' },
      el('span', {}, t('toast.friend', { name: msg.from?.name ?? t('toast.someone') })),
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            toast.remove();
            navigate('account');
          },
        },
        t('toast.view'),
      ),
      el('button', { class: 'btn btn--ghost', onclick: () => toast.remove() }, t('toast.later')),
    );
    document.body.append(toast);
  }

  function renderRoute(route) {
    const { tab, gameId, roomCode, joinCode } = route;
    lastRoute = route;
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
