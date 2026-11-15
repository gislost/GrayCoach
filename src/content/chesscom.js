import { runContent, getSettingsLite, NOT_FINISHED } from './common.js';
import { decodeTCN, moveToUci } from '../lib/tcn.js';
import { stringifyHeaders, colorOf } from '../lib/pgn.js';

const URL_PATTERNS = [
  /\/game\/(live|daily)\/(\d+)/,
  /\/(live|daily)\/game\/(\d+)/,
  /\/analysis\/game\/(live|daily)\/(\d+)/,
  /\/game\/(\d+)(?:[/?#]|$)/, // newer URLs without the live/daily part
];

const LINK_SELECTOR = [
  'a[href*="/game/live/"]',
  'a[href*="/game/daily/"]',
  'a[href*="/analysis/game/live/"]',
  'a[href*="/analysis/game/daily/"]',
].join(',');

function parseIdFrom(str) {
  for (const re of URL_PATTERNS) {
    const m = str.match(re);
    if (m) return m.length === 3 ? { type: m[1], id: m[2] } : { type: null, id: m[1] };
  }
  return null;
}

function detect() {
  const fromUrl = parseIdFrom(location.pathname);
  if (fromUrl) return fromUrl;
  // After a game on /play/..., the game-over dialog links to the finished game.
  if (location.pathname.startsWith('/play')) {
    const modal = document.querySelector('.game-over-modal-content, [class*="game-over"], .board-modal-container');
    const a = (modal || document).querySelector(LINK_SELECTOR);
    if (a) return parseIdFrom(new URL(a.href, location.href).pathname);
  }
  return null;
}

async function fetchCallback(type, id) {
  try {
    const r = await fetch(`/callback/${type}/game/${id}`, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.game ? j : null;
  } catch {
    return null;
  }
}

async function fetchGame(det) {
  const settings = await getSettingsLite();
  let data = null;
  let type = det?.type;
  if (det) {
    for (const t of type ? [type] : ['live', 'daily']) {
      data = await fetchCallback(t, det.id);
      if (data) { type = t; break; }
    }
  }

  if (data) {
    const g = data.game;
    if (!g.isFinished) throw new Error(NOT_FINISHED);
    if (g.type && g.type !== 'chess') {
      throw new Error(`Only standard chess is supported (this game is ${g.typeName || g.type}).`);
    }
    const headers = stringifyHeaders(g.pgnHeaders);
    const startFen = headers.SetUp === '1' && headers.FEN ? headers.FEN : null;
    const uci = decodeTCN(g.moveList || '').map(moveToUci);
    const bottom = data.players?.bottom;
    const playerColor = colorOf(settings.chesscomUser, headers) || (bottom?.color === 'white' || bottom?.color === 'black' ? bottom.color : null);
    return {
      site: 'chess.com',
      id: String(g.id || det.id),
      url: `https://www.chess.com/game/${type}/${g.id || det.id}`,
      headers,
      startFen,
      uci,
      playerColor,
    };
  }

  // Fallback: the public API (finished games only), searched by your username.
  const username = settings.chesscomUser;
  if (!username) {
    throw new Error(
      det
        ? "Couldn't load this game from chess.com. Set your chess.com username in the extension settings and try again."
        : "Couldn't find a finished game on this page. Open the game (chess.com/game/…) or set your chess.com username in the extension settings.",
    );
  }
  const res = await chrome.runtime.sendMessage({ type: 'chesscomPublic', username, id: det?.id || null });
  if (!res?.ok) throw new Error(res?.error || 'chess.com lookup failed.');
  return res.game;
}

runContent({ detect, fetchGame });
