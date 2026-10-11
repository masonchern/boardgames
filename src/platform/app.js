import { el } from '../core/dom.js';
import { navigate, startRouter } from '../core/router.js';
import { renderLobby } from './pages/lobby.js';
import { renderGamePage } from './pages/gamePage.js';
import { renderAccount } from './pages/account.js';
import { renderSettings } from './pages/settings.js';

/** Sidebar tabs. Add a page by adding an entry here and a case in `renderRoute`. */
const TABS = [
  { id: 'games', label: 'Games', icon: '🎮' },
  { id: 'account', label: 'Account', icon: '👤' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export function createApp(root) {
  const content = el('main', { class: 'content' });
  const navButtons = new Map();

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
    el('div', { class: 'sidebar__footer muted' }, 'Guest mode · v0.1'),
  );

  root.append(el('div', { class: 'shell' }, sidebar, content));

  let teardown = null;

  function renderRoute({ tab, gameId }) {
    teardown?.();
    teardown = null;

    navButtons.forEach((btn, id) => btn.classList.toggle('is-active', id === tab));

    let node;
    if (tab === 'games' && gameId) {
      const page = renderGamePage(gameId);
      node = page.node;
      teardown = page.destroy;
    } else if (tab === 'account') node = renderAccount();
    else if (tab === 'settings') node = renderSettings();
    else node = renderLobby();

    node.classList.add('page-enter');
    content.replaceChildren(node);
  }

  startRouter(renderRoute);
}
