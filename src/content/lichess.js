import { runContent, getSettingsLite, NOT_FINISHED } from './common.js';
import { parsePgnHeaders, colorOf } from '../lib/pgn.js';

// 8-letter site paths that look like game ids.
const RESERVED = new Set([
  'training', 'analysis', 'practice', 'streamer', 'tutorial', 'insights', 'download', 'features', 'feedback',
  'patron', 'storm', 'racer', 'streak', 'contact', 'timeline', 'settings', 'password', 'username', 'opening',
]);

function detect() {
  const m = location.pathname.match(/^\/([a-zA-Z0-9]{8})([a-zA-Z0-9]{4})?(?:\/(white|black))?\/?$/);
  if (!m || RESERVED.has(m[1].toLowerCase())) return null;
  if (!document.querySelector('main.round, main.analyse')) return null;
  return { id: m[1], color: m[3] || null };
}

async function fetchGame(det) {
  if (!det) throw new Error('Open a Lichess game page first.');
  const r = await fetch(`/game/export/${det.id}?clocks=false&evals=false&literate=false&opening=true`, {
    headers: { Accept: 'application/x-chess-pgn' },
  });
  if (r.status === 404) throw new Error("Lichess couldn't find that game.");
  if (!r.ok) throw new Error(`Lichess export failed (HTTP ${r.status}).`);
  const pgn = (await r.text()).trim();
  const headers = parsePgnHeaders(pgn);
  if (!headers.Result || headers.Result === '*') throw new Error(NOT_FINISHED);
  if (headers.Variant && !['Standard', 'From Position'].includes(headers.Variant)) {
    throw new Error(`Only standard chess is supported (this game is ${headers.Variant}).`);
  }
  const settings = await getSettingsLite();
  const me = document.body?.dataset?.user || settings.lichessUser;
  const playerColor = colorOf(me, headers) || det.color;
  return { site: 'lichess', id: det.id, url: `https://lichess.org/${det.id}`, pgn, headers, playerColor };
}

runContent({ detect, fetchGame });
