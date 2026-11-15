/** Reads the [Tag "value"] header pairs from a PGN. */
export function parsePgnHeaders(pgn) {
  const h = {};
  for (const m of String(pgn).matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) {
    h[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
  }
  return h;
}

/** Normalises header values to strings (chess.com sends some as numbers). */
export function stringifyHeaders(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (v != null) out[k] = String(v);
  return out;
}

export function colorOf(username, headers) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  if ((headers.White || '').toLowerCase() === u) return 'white';
  if ((headers.Black || '').toLowerCase() === u) return 'black';
  return null;
}
