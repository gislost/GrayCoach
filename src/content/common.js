// Floating "Coach review" button shared by the chess.com and Lichess content scripts.
// The button only offers a review; the fetch step refuses games that aren't finished.

const CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483646; display: flex; flex-direction: column;
  align-items: flex-end; gap: 8px; font: 600 14px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
.row { display: flex; align-items: center; gap: 4px; }
button.main { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 10px 16px;
  background: #2ea043; color: #fff; font: inherit; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
button.main:hover { background: #3fb950; }
button.main:disabled { background: #57606a; cursor: progress; }
button.x { border: 0; background: rgba(0,0,0,.55); color: #fff; width: 22px; height: 22px; border-radius: 50%;
  cursor: pointer; font: 700 12px/22px system-ui; padding: 0; }
.toast { max-width: 320px; padding: 10px 12px; border-radius: 10px; background: #161b22; color: #e6edf3;
  box-shadow: 0 6px 18px rgba(0,0,0,.4); font-weight: 500; border-left: 4px solid #2ea043; }
.toast.err { border-left-color: #f85149; }
.hidden { display: none !important; }
`;

export function createButton() {
  const host = document.createElement('div');
  host.id = 'graycoach';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="wrap hidden">
      <div class="toast hidden" role="status"></div>
      <div class="row">
        <button class="x" title="Hide on this page" aria-label="Hide">✕</button>
        <button class="main" title="Analyze this finished game with Stockfish and get a coach review">♞ <span>Coach review</span></button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const wrap = root.querySelector('.wrap');
  const main = root.querySelector('button.main');
  const label = main.querySelector('span');
  const toastEl = root.querySelector('.toast');
  let dismissedFor = null;
  let toastTimer;

  root.querySelector('button.x').addEventListener('click', () => {
    dismissedFor = location.pathname;
    wrap.classList.add('hidden');
  });

  return {
    setVisible(v) {
      if (dismissedFor && dismissedFor !== location.pathname) dismissedFor = null;
      wrap.classList.toggle('hidden', !v || dismissedFor === location.pathname);
    },
    setBusy(busy, text) {
      main.disabled = busy;
      label.textContent = busy ? text || 'Loading…' : 'Coach review';
    },
    toast(msg, kind = 'ok') {
      clearTimeout(toastTimer);
      toastEl.textContent = msg;
      toastEl.classList.toggle('err', kind === 'err');
      toastEl.classList.remove('hidden');
      toastTimer = setTimeout(() => toastEl.classList.add('hidden'), kind === 'err' ? 9000 : 3500);
    },
    onClick(fn) {
      main.addEventListener('click', fn);
    },
  };
}

export async function getSettingsLite() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    return settings || {};
  } catch {
    return {};
  }
}

/**
 * Wires a site adapter to the button and to the popup's "Review this game".
 * @param {{ detect: () => any, fetchGame: (detected: any) => Promise<object> }} site
 */
export function runContent(site) {
  if (window.top !== window) return; // not inside iframes
  const ui = createButton();
  const tick = () => {
    try { ui.setVisible(!!site.detect()); } catch { ui.setVisible(false); }
  };
  tick();
  setInterval(tick, 1000); // both sites are single-page apps

  async function openReview() {
    const game = await site.fetchGame(site.detect());
    const res = await chrome.runtime.sendMessage({ type: 'openReview', game });
    if (!res?.ok) throw new Error(res?.error || 'Could not open the review tab.');
  }

  ui.onClick(async () => {
    ui.setBusy(true, 'Loading game…');
    try {
      await openReview();
      ui.toast('Review opened in a new tab.');
    } catch (e) {
      ui.toast(e.message || String(e), 'err');
    } finally {
      ui.setBusy(false);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'reviewThisGame') return;
    openReview().then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: e.message || String(e) }),
    );
    return true;
  });
}

export const NOT_FINISHED = "This game isn't over yet. The coach only reviews finished games — finish (or resign) first.";
