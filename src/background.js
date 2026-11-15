import { saveGame } from './lib/store.js';
import { getSettings } from './lib/settings.js';
import { parsePgnHeaders, colorOf } from './lib/pgn.js';

const handlers = { openReview, chesscomPublic, latestGame };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return;
  h(msg).then(
    (data) => sendResponse({ ok: true, ...data }),
    (e) => sendResponse({ ok: false, error: e?.message || String(e) }),
  );
  return true; // async response
});

async function openReview({ game }) {
  if (!game || !game.site || !game.id || !(game.pgn || Array.isArray(game.uci))) {
    throw new Error('Game data was incomplete.');
  }
  const key = await saveGame(game);
  await chrome.tabs.create({ url: chrome.runtime.getURL('review/review.html?g=' + encodeURIComponent(key)) });
  return { key };
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

async function latestGame({ site }) {
  const s = await getSettings();
  if (site === 'chess.com') {
    if (!s.chesscomUser) throw new Error('Set your chess.com username in settings first.');
    return chesscomPublic({ username: s.chesscomUser, id: null }).then(async ({ game }) => openReview({ game }));
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
    return openReview({ game: { site: 'lichess', id, url: headers.Site, pgn, headers, playerColor: colorOf(s.lichessUser, headers) } });
  }
  throw new Error('Unknown site.');
}
