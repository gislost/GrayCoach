// Turns move notation in the coach's text ("11... Nc2+", "6. cxd4", "7. Qd1 Nxe4") into links that
// jump the board to that move. Moves that weren't played (the coach's suggestions) link to the
// position where they were possible and carry the move, so the board can draw it as an arrow.
import { Chess } from 'chess.js';

const SAN = String.raw`(?:[O0]-[O0](?:-[O0])?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?)[+#]?[!?]{0,2}`;
// "11." for White; "11...", "11…" or "11. ..." for Black.
const DOTS = String.raw`(?:\.\s*(?:\.\.\.|…)|\.\.\.|…|\.)`;
const NUM = String.raw`\d{1,3}\s*${DOTS}\s*`;
// A run is a numbered move plus any moves that follow it: "7. Qd1 Nxe4 8. Nc3".
const RUN_RE = new RegExp(String.raw`(?<![\w-])${NUM}${SAN}(?:\s+(?:${NUM})?${SAN})*(?![\w-])`, 'g');
const TOK_RE = new RegExp(String.raw`(?:(\d{1,3})\s*(${DOTS})\s*)?(${SAN})`, 'g');

/** True when text starts with a move in SAN (so "6. cxd4 ..." isn't mistaken for a numbered list). */
export const startsWithSan = (text) => new RegExp(String.raw`^${SAN}(?![\w-])`).test(text);

const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 1-based ply of move number n for color 'w'/'b', or null if outside the game (one past the end is allowed). */
function plyFor(plies, n, color) {
  const p0 = plies[0];
  const idx = (n - p0.moveNo) * 2 + (color === 'b' ? 1 : 0) - (p0.color === 'b' ? 1 : 0);
  return idx >= 0 && idx <= plies.length ? idx + 1 : null;
}

function tryMove(fen, san) {
  try {
    return new Chess(fen).move(san.replace(/0/g, 'O').replace(/[!?]+$/, ''));
  } catch {
    return null;
  }
}

function moveLabel(fen, san) {
  const parts = fen.split(' ');
  return `${parts[5] || 1}${parts[1] === 'b' ? '...' : '.'} ${san}`;
}

/** A link for move `san` (shown as `tok`) at ply `ply`, or null if it isn't legal there. */
function linkOne(tok, ply, san, { plies, positions }) {
  const fen = positions[ply - 1].fen;
  const played = plies[ply - 1];
  const mv = tryMove(fen, san);
  if (!mv) return null;
  if (played && mv.lan === played.uci) {
    return { alt: false, html: `<a href="#" class="mvlink" data-ply="${ply}" title="Show ${escAttr(moveLabel(fen, played.san))} on the board">${tok}</a>` };
  }
  const label = moveLabel(fen, mv.san);
  return {
    alt: true,
    html: `<a href="#" class="mvlink alt" data-ply="${ply - 1}" data-uci="${escAttr(mv.lan)}" data-label="${escAttr(label)}"` +
      ` title="${escAttr(label)} wasn't played. Click to see it as an arrow on the board.">${tok}</a>`,
  };
}

function linkRun(run, game) {
  const { plies } = game;
  let out = '';
  let last = 0;
  let mode = 'game'; // 'game': following the game; 'var': inside a line that wasn't played; 'none': unreadable
  let expect = null; // ply the next bare move belongs to
  TOK_RE.lastIndex = 0;
  for (let m; (m = TOK_RE.exec(run)); ) {
    out += run.slice(last, m.index);
    last = TOK_RE.lastIndex;
    const [tok, num, dots, san] = m;
    const ply = num ? plyFor(plies, +num, dots === '.' ? 'w' : 'b') : expect;
    // A numbered move restarts the reading unless it simply continues the line being shown.
    if (num && !(mode === 'var' && ply === expect)) mode = 'game';
    expect = ply ? ply + 1 : null;
    if (!ply || ply > plies.length + 1 || mode !== 'game') { out += tok; continue; }

    const link = linkOne(tok, ply, san, game);
    out += link ? link.html : tok;
    if (!link) mode = 'none';
    else if (link.alt) mode = 'var';
  }
  return out + run.slice(last);
}

/**
 * Links a bare move with no move number ("Qc7"), read in the position before ply `ply`: the coach's
 * "better move" for a key moment. Returns null when the text isn't a single legal move there.
 */
export function linkMoveAt(text, ply, game) {
  const san = String(text ?? '').trim();
  if (!game?.plies?.length || !(ply >= 1 && ply <= game.plies.length)) return null;
  if (!new RegExp(String.raw`^${SAN}$`).test(san)) return null;
  return linkOne(san, ply, san, game)?.html ?? null;
}

/**
 * Links the move notation in already-escaped HTML. Only text between tags is touched.
 * @param {string} html
 * @param {{ plies: object[], positions: object[] }} game  from buildGame()
 */
export function linkMoves(html, game) {
  if (!game?.plies?.length) return html;
  return String(html)
    .split(/(<[^>]*>)/)
    .map((part, i) => (i % 2 ? part : part.replace(RUN_RE, (run) => linkRun(run, game))))
    .join('');
}
