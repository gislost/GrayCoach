// Turns a saved game record (PGN, or UCI moves + optional start FEN) into a ply-by-ply model.
import { Chess } from 'chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function positionInfo(fen) {
  const c = new Chess(fen);
  let terminal = null;
  if (c.isCheckmate()) terminal = 'checkmate';
  else if (c.isStalemate()) terminal = 'stalemate';
  else if (c.isInsufficientMaterial()) terminal = 'insufficient';
  return { fen, turn: c.turn(), inCheck: c.inCheck(), legal: c.moves().length, terminal };
}

function plyFromMove(m, i, startMoveNo, startTurn) {
  const half = i + (startTurn === 'b' ? 1 : 0);
  return {
    ply: i + 1,
    moveNo: startMoveNo + Math.floor(half / 2),
    color: m.color,
    san: m.san,
    uci: m.lan,
    from: m.from,
    to: m.to,
    fenBefore: m.before,
    fenAfter: m.after,
  };
}

/**
 * @returns {{ headers: Record<string,string>, startFen: string, plies: object[], positions: object[] }}
 * positions[0] is the start; positions[k] is after ply k.
 */
export function buildGame(rec) {
  let headers = { ...(rec.headers || {}) };
  let startFen = rec.startFen || START_FEN;
  let moves;

  if (rec.pgn) {
    const c = new Chess();
    c.loadPgn(rec.pgn, { strict: false });
    headers = { ...c.getHeaders(), ...headers };
    moves = c.history({ verbose: true });
    startFen = moves[0]?.before || headers.FEN || START_FEN;
  } else {
    const c = new Chess(startFen);
    moves = (rec.uci || []).map((u, i) => {
      try {
        return c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      } catch {
        throw new Error(`Move ${i + 1} (${u}) is illegal — the game data looks corrupted.`);
      }
    });
  }

  const startParts = startFen.split(' ');
  const startTurn = startParts[1] || 'w';
  const startMoveNo = parseInt(startParts[5], 10) || 1;
  const plies = moves.map((m, i) => plyFromMove(m, i, startMoveNo, startTurn));
  const positions = [positionInfo(startFen), ...plies.map((p) => positionInfo(p.fenAfter))];
  return { headers, startFen, plies, positions };
}

/** "14." for white, "14..." for black. */
export function movePrefix(p) {
  return p.color === 'w' ? `${p.moveNo}.` : `${p.moveNo}...`;
}

/** Converts a UCI line to SAN from a position; stops at the first illegal move. */
export function uciLineToSan(fen, uciMoves, max = 6) {
  const c = new Chess(fen);
  const out = [];
  for (const u of (uciMoves || []).slice(0, max)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }).san);
    } catch {
      break;
    }
  }
  return out;
}

/** Formats a SAN line with move numbers, starting from the side to move in `fen`. */
export function formatLine(fen, sans) {
  const parts = fen.split(' ');
  let turn = parts[1] || 'w';
  let no = parseInt(parts[5], 10) || 1;
  const out = [];
  sans.forEach((s, i) => {
    if (turn === 'w') out.push(`${no}. ${s}`);
    else out.push(i === 0 ? `${no}... ${s}` : s);
    if (turn === 'b') no++;
    turn = turn === 'w' ? 'b' : 'w';
  });
  return out.join(' ');
}
