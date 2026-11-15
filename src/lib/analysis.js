// Engine pass over every position, then move grading and accuracy.
import { uciLineToSan, formatLine } from './game.js';

export const CLASSES = {
  best: { label: 'Best move', glyph: '★', short: 'best' },
  excellent: { label: 'Excellent', glyph: '', short: 'excellent' },
  good: { label: 'Good', glyph: '', short: 'good' },
  forced: { label: 'Only move', glyph: '□', short: 'forced' },
  inaccuracy: { label: 'Inaccuracy', glyph: '?!', short: 'inaccuracy' },
  mistake: { label: 'Mistake', glyph: '?', short: 'mistake' },
  blunder: { label: 'Blunder', glyph: '??', short: 'blunder' },
};

export const BAD = new Set(['inaccuracy', 'mistake', 'blunder']);

/** Win probability for White (0..1) from a White-POV evaluation. */
export function wpWhite(ev) {
  if (!ev) return 0.5;
  if (ev.mate != null) {
    if (ev.mate > 0) return 1;
    if (ev.mate < 0) return 0;
    return ev.winner === 'w' ? 1 : 0;
  }
  if (ev.cp == null) return 0.5;
  return 1 / (1 + Math.exp(-0.00368208 * ev.cp));
}

export function wpFor(ev, color) {
  const w = wpWhite(ev);
  return color === 'w' ? w : 1 - w;
}

/** Centipawns for White, mates clamped to ±1000. */
export function cpWhite(ev) {
  if (!ev) return 0;
  if (ev.mate != null) return ev.mate > 0 || (ev.mate === 0 && ev.winner === 'w') ? 1000 : -1000;
  return Math.max(-1000, Math.min(1000, ev.cp ?? 0));
}

export function formatEval(ev) {
  if (!ev) return '…';
  if (ev.mate != null) {
    if (ev.mate === 0) return ev.winner === 'w' ? '1-0' : ev.winner === 'b' ? '0-1' : '½-½';
    return ev.mate > 0 ? `#${ev.mate}` : `#-${-ev.mate}`;
  }
  const v = (ev.cp ?? 0) / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
}

function terminalEval(pos) {
  if (pos.terminal === 'checkmate') return { mate: 0, winner: pos.turn === 'w' ? 'b' : 'w', best: null, pv: [], depth: 0 };
  return { cp: 0, best: null, pv: [], depth: 0 };
}

function movetimeCap(depth) {
  return depth <= 12 ? 1500 : depth <= 15 ? 3000 : 7000;
}

/**
 * Runs the engine on every position. Evals are converted to White's point of view.
 * @param {(i:number,total:number,evals:object[])=>void} onProgress
 */
export async function analysePositions(positions, engine, { depth, onProgress, shouldStop }) {
  const evals = new Array(positions.length).fill(null);
  for (let i = 0; i < positions.length; i++) {
    if (shouldStop?.()) throw new Error('stopped');
    const pos = positions[i];
    if (pos.terminal) {
      evals[i] = terminalEval(pos);
    } else {
      const r = await engine.analyse(pos.fen, { depth, movetime: movetimeCap(depth) });
      const sign = pos.turn === 'w' ? 1 : -1;
      evals[i] = {
        best: r.best,
        pv: r.pv,
        depth: r.depth,
        ...(r.mate != null ? { mate: r.mate * sign } : { cp: (r.cp ?? 0) * sign }),
      };
      if (r.mate === 0) Object.assign(evals[i], { mate: 0, winner: pos.turn === 'w' ? 'b' : 'w' });
    }
    onProgress?.(i + 1, positions.length, evals);
  }
  return evals;
}

function moveAccuracy(wpBeforePct, wpAfterPct) {
  const diff = Math.max(0, wpBeforePct - wpAfterPct);
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

function gameAccuracy(list) {
  if (!list.length) return null;
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  const harmonic = list.length / list.reduce((a, b) => a + 1 / Math.max(b, 0.5), 0);
  return (mean + harmonic) / 2;
}

/** Grades each ply against the engine. Needs evals for every position. */
export function gradeGame(game, evals) {
  const moves = [];
  const acc = { w: [], b: [] };
  const cpl = { w: [], b: [] };
  const counts = { w: {}, b: {} };

  game.plies.forEach((p, idx) => {
    const before = evals[idx];
    const after = evals[idx + 1];
    const pos = game.positions[idx];
    const mover = p.color;
    const wpB = wpFor(before, mover);
    const wpA = wpFor(after, mover);
    const loss = Math.max(0, wpB - wpA);

    let cls;
    if (pos.legal === 1) cls = 'forced';
    else if (before?.best && before.best === p.uci) cls = 'best';
    else if (loss < 0.02) cls = 'excellent';
    else if (loss < 0.05) cls = 'good';
    else if (loss < 0.1) cls = 'inaccuracy';
    else if (loss < 0.2) cls = 'mistake';
    else cls = 'blunder';

    const prev = moves[idx - 1];
    const missed = !!prev && (prev.cls === 'mistake' || prev.cls === 'blunder') && loss >= 0.1;

    const bestSan = before?.best ? uciLineToSan(p.fenBefore, [before.best], 1)[0] || null : null;
    const pvSan = before?.pv ? uciLineToSan(p.fenBefore, before.pv, 6) : [];

    const sign = mover === 'w' ? 1 : -1;
    const cpLoss = Math.max(0, Math.min(1000, sign * (cpWhite(before) - cpWhite(after))));

    acc[mover].push(moveAccuracy(wpB * 100, wpA * 100));
    cpl[mover].push(cpLoss);
    counts[mover][cls] = (counts[mover][cls] || 0) + 1;
    if (missed) counts[mover].missed = (counts[mover].missed || 0) + 1;

    moves.push({
      ...p,
      cls,
      missed,
      loss,
      cpLoss,
      evalBefore: before,
      evalAfter: after,
      bestUci: before?.best || null,
      bestSan,
      bestLine: pvSan.length ? formatLine(p.fenBefore, pvSan) : '',
    });
  });

  const avg = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
  return {
    moves,
    accuracy: { w: gameAccuracy(acc.w), b: gameAccuracy(acc.b) },
    acpl: { w: avg(cpl.w), b: avg(cpl.b) },
    counts,
  };
}
