import { saveGame } from './lib/store.js';
import { getSettings } from './lib/settings.js';
import { parsePgnHeaders, colorOf } from './lib/pgn.js';

const handlers = { openPanel, openReview, openSaved, panelError, chesscomPublic, latestGame };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return;
  // Handlers run synchronously up to their first await, so one that opens the side panel does it
  // while the click that sent the message still counts as a user action.
  h(msg, sender).then(
    (data) => sendResponse({ ok: true, ...data }),
    async (e) => {
      const error = e?.message || String(e);
      if (msg.where === 'panel' && msg.type !== 'panelError') await showPanelError(tabOf(msg, sender), error);
      sendResponse({ ok: false, error });
    },
  );
  return true; // async response
});

// ---------- where reviews open ----------
// 'panel': the browser's side panel for the chess tab the user clicked from (Chrome/Edge 114+).
// It opens at once showing "Loading…", and the game is loaded into it when it's ready. The panel
// only ever shows a game the user asked for. If it can't open, the review opens in a new tab.

const REVIEW = 'review/review.html';
const tabOf = (msg, sender) => msg.tabId ?? sender?.tab?.id;
const panelOpens = new Map(); // tabId -> Promise<boolean>: did the last open attempt work?

function setPanel(tabId, query) {
  return chrome.sidePanel.setOptions({ tabId, path: `${REVIEW}?panel=1&${query}`, enabled: true });
}

/** Opens the side panel on a tab. Call it before any await in a message handler (see above). */
function startPanel(tabId, query = 'loading=1') {
  let p;
  try {
    if (!chrome.sidePanel?.open || !Number.isInteger(tabId)) throw new Error('No side panel here.');
    p = Promise.all([setPanel(tabId, query), chrome.sidePanel.open({ tabId })]).then(() => true);
  } catch (e) {
    p = Promise.reject(e);
  }
  p = p.catch((e) => {
    console.warn('GrayCoach: side panel did not open, using a tab.', e?.message || e);
    return false;
  });
  panelOpens.set(tabId, p);
  return p;
}

async function showPanelError(tabId, error) {
  if (await panelOpens.get(tabId)) await setPanel(tabId, 'error=' + encodeURIComponent(String(error).slice(0, 400)));
}

async function openTab(key) {
  await chrome.tabs.create({ url: chrome.runtime.getURL(`${REVIEW}?g=${encodeURIComponent(key)}`) });
}

/** The page's Coach review button (or the popup) asks for the panel before it fetches the game. */
async function openPanel(msg, sender) {
  return { opened: await startPanel(tabOf(msg, sender)) };
}

/** The game couldn't be fetched: say why in the panel that's waiting for it. */
async function panelError(msg, sender) {
  await showPanelError(tabOf(msg, sender), msg.error || 'Something went wrong.');
  return {};
}

async function openReview(msg, sender) {
  const { game } = msg;
  if (!game || !game.site || !game.id || !(game.pgn || Array.isArray(game.uci))) {
    throw new Error('Game data was incomplete.');
  }
  const key = await saveGame(game);
  const tabId = tabOf(msg, sender);
  if (msg.where === 'panel' && (await panelOpens.get(tabId))) {
    await setPanel(tabId, 'g=' + encodeURIComponent(key));
    return { key, where: 'panel' };
  }
  await openTab(key);
  return { key, where: 'tab' };
}

/** A saved review from the popup's recent list. */
async function openSaved(msg, sender) {
  const key = String(msg.key || '');
  if (!key.startsWith('game:')) throw new Error('Unknown game.');
  if (msg.where === 'panel' && (await startPanel(tabOf(msg, sender), 'g=' + encodeURIComponent(key)))) return { where: 'panel' };
  await openTab(key);
  return { where: 'tab' };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (r.status === 404) throw new Error('Not found on chess.com (check the username in settings).');
  if (!r.ok) throw new Error(`chess.com API error (HTTP ${r.status}).`);
  return r.json();
}

function fromChesscomPublic(g, username) {
  const headers = parsePgnHeaders(g.pgn);
  return {
    site: 'chess.com',
    id: String(g.url.split('/').pop()),
    url: g.url,
    pgn: g.pgn,
    headers,
    playerColor: colorOf(username, headers),
  };
}

/** Finds a finished game (by id, or the latest one) in the user's last few monthly archives. */
async function chesscomPublic({ username, id }) {
  const u = String(username).trim().toLowerCase();
  const { archives = [] } = await getJSON(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
  for (const month of archives.slice(-3).reverse()) {
    const { games = [] } = await getJSON(month);
    const list = games.filter((g) => g.rules === 'chess' && g.pgn).sort((a, b) => (a.end_time || 0) - (b.end_time || 0));
    const found = id ? list.find((g) => g.url && g.url.endsWith('/' + id)) : list.at(-1);
    if (found) return { game: fromChesscomPublic(found, u) };
  }
  throw new Error(
    id
      ? "Couldn't find that game in your recent chess.com games yet (the public API can lag a minute after a game ends)."
      : `No recent standard games found for ${username} on chess.com.`,
  );
}

async function latestGame(msg, sender) {
  const { site, where } = msg;
  if (where === 'panel') startPanel(tabOf(msg, sender)); // before the first await
  const s = await getSettings();
  const open = (game) => openReview({ game, where, tabId: msg.tabId }, sender);
  if (site === 'chess.com') {
    if (!s.chesscomUser) throw new Error('Set your chess.com username in settings first.');
    return chesscomPublic({ username: s.chesscomUser, id: null }).then(({ game }) => open(game));
  }
  if (site === 'lichess') {
    if (!s.lichessUser) throw new Error('Set your Lichess username in settings first.');
    const u = encodeURIComponent(s.lichessUser.trim());
    // Only finished games are returned by default.
    const r = await fetch(`https://lichess.org/api/games/user/${u}?max=1&clocks=false&evals=false&opening=true&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence`, {
      headers: { Accept: 'application/x-chess-pgn' },
    });
    if (!r.ok) throw new Error(`Lichess API error (HTTP ${r.status}).`);
    const pgn = (await r.text()).trim();
    if (!pgn) throw new Error(`No finished games found for ${s.lichessUser} on Lichess.`);
    const headers = parsePgnHeaders(pgn);
    if (!headers.Result || headers.Result === '*') throw new Error("Your latest Lichess game isn't finished yet.");
    const id = (headers.Site || '').split('/').pop();
    return open({ site: 'lichess', id, url: headers.Site, pgn, headers, playerColor: colorOf(s.lichessUser, headers) });
  }
  throw new Error('Unknown site.');
}
