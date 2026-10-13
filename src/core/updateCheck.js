import { buildInfo } from './buildInfo.js';
import { el } from './dom.js';
import { t } from './i18n.js';

const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Browsers and phones cache pages aggressively, so people can keep playing an old build for a long
 * time. The build writes `version.json` next to index.html. This asks for it (bypassing the cache)
 * now, every few minutes and whenever the tab becomes visible again. If it names a different
 * commit than the one running here, a banner offers a one-tap update.
 * Dev servers are skipped. Never throws: being offline just means no banner.
 */
export function startUpdateCheck() {
  if (buildInfo.kind === 'dev') return () => {};

  let banner = null;
  let stopped = false;

  async function check() {
    if (stopped || banner) return;
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = await res.json();
      if (latest?.commit && latest.commit !== buildInfo.commit) showBanner(latest.commit);
    } catch {
      // Offline or blocked: try again later
    }
  }

  function showBanner(latestCommit) {
    banner = el(
      'div',
      { class: 'update-banner', role: 'status' },
      el('span', {}, t('update.blurb')),
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            // A new query string makes the browser fetch a fresh index.html instead of the cached one.
            const url = new URL(window.location.href);
            url.searchParams.set('v', latestCommit);
            window.location.replace(url.toString());
          },
        },
        t('update.now'),
      ),
    );
    document.body.append(banner);
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(check, CHECK_EVERY_MS);
  check();

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    banner?.remove();
  };
}
