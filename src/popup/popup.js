import { getSettings, MODELS } from '../lib/settings.js';
import { getRecent } from '../lib/store.js';

const $ = (id) => document.getElementById(id);

function say(text, kind = '') {
  const m = $('msg');
  m.textContent = text;
  m.className = 'msg ' + kind;
}

function openTab(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  say('');
  try {
    await fn();
    window.close();
  } catch (e) {
    say(e.message || String(e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error || 'Something went wrong.');
  return res;
}

async function init() {
  const s = await getSettings();
  const model = MODELS.find((m) => m.id === s.model)?.label.replace(/\s*\(.*\)$/, '') || s.model;
  $('keyStatus').textContent = s.apiKey ? `Coach: ${model}` : 'Engine only (add an API key for the coach)';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Side panel mode: the panel must be opened during the click, so these messages go out before any await.
  const where = s.openIn === 'tab' ? 'tab' : 'panel';
  const startPanel = () => {
    if (where === 'panel') chrome.runtime.sendMessage({ type: 'openPanel', tabId: tab?.id }).catch(() => {});
  };
  const onChessSite = /^https:\/\/(www\.chess\.com|lichess\.org)\//.test(tab?.url || '');
  const thisBtn = $('thisGame');
  if (!onChessSite) {
    thisBtn.disabled = true;
    thisBtn.title = 'Open a finished game on chess.com or Lichess';
  }
  thisBtn.addEventListener('click', () =>
    busy(thisBtn, 'Loading game…', async () => {
      startPanel();
      let res;
      try {
        res = await chrome.tabs.sendMessage(tab.id, { type: 'reviewThisGame', where });
      } catch {
        const error = 'Reload the chess tab and try again (the extension was installed or updated after it opened).';
        if (where === 'panel') send({ type: 'panelError', where, tabId: tab.id, error }).catch(() => {});
        throw new Error(error);
      }
      if (!res?.ok) throw new Error(res?.error || 'No finished game found on this page.');
    }),
  );

  const cc = $('latestChesscom');
  const li = $('latestLichess');
  if (s.chesscomUser) cc.textContent = `Latest chess.com game (${s.chesscomUser})`;
  if (s.lichessUser) li.textContent = `Latest Lichess game (${s.lichessUser})`;
  cc.addEventListener('click', () => {
    if (!s.chesscomUser) return say('Set your chess.com username in Settings first.', 'err');
    busy(cc, 'Finding your latest game…', () => send({ type: 'latestGame', site: 'chess.com', where, tabId: tab?.id }));
  });
  li.addEventListener('click', () => {
    if (!s.lichessUser) return say('Set your Lichess username in Settings first.', 'err');
    busy(li, 'Finding your latest game…', () => send({ type: 'latestGame', site: 'lichess', where, tabId: tab?.id }));
  });
  $('paste').addEventListener('click', () => openTab('review/review.html?paste=1'));
  $('settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  const recent = (await getRecent()).slice(0, 8);
  if (recent.length) {
    $('recentBox').hidden = false;
    const box = $('recent');
    for (const r of recent) {
      const a = document.createElement('a');
      a.href = '#';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${r.white} vs ${r.black}`;
      const res = document.createElement('span');
      res.className = 'res';
      res.textContent = r.result;
      a.append(who, res);
      a.title = [r.site, r.date].filter(Boolean).join(' · ');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        send({ type: 'openSaved', key: r.key, where, tabId: tab?.id }).then(
          () => window.close(),
          (err) => say(err.message || String(err), 'err'),
        );
      });
      box.appendChild(a);
    }
  }
}

init();
