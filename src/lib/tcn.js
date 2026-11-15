// Decoder for chess.com's TCN move encoding (two characters per move).
const T = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=';
const FILES = 'abcdefgh';

/** @returns {{from:string,to:string,promotion?:string}[]} */
export function decodeTCN(tcn) {
  const moves = [];
  for (let i = 0; i + 1 < tcn.length; i += 2) {
    const o = T.indexOf(tcn[i]);
    let s = T.indexOf(tcn[i + 1]);
    let promotion;
    if (s > 63) {
      promotion = 'qnrbkp'[Math.floor((s - 64) / 3)];
      s = o + (o < 16 ? -8 : 8) + ((s - 1) % 3) - 1;
    }
    if (o > 75) throw new Error('Drop moves (crazyhouse) are not supported');
    const m = { from: FILES[o % 8] + (Math.floor(o / 8) + 1), to: FILES[s % 8] + (Math.floor(s / 8) + 1) };
    if (promotion) m.promotion = promotion;
    moves.push(m);
  }
  return moves;
}

export function moveToUci(m) {
  return m.from + m.to + (m.promotion || '');
}
