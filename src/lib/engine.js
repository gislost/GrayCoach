// Stockfish (WASM, single-threaded) in a Web Worker, spoken to over UCI.

function parseInfo(line) {
  const t = line.split(/\s+/);
  const out = {};
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': out.depth = +t[++i]; break;
      case 'multipv': out.multipv = +t[++i]; break;
      case 'score': {
        const kind = t[++i];
        const v = +t[++i];
        if (kind === 'cp') out.cp = v;
        else if (kind === 'mate') out.mate = v;
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') { out.bound = true; i++; }
        break;
      }
      case 'pv': out.pv = t.slice(i + 1); i = t.length; break;
      default: break;
    }
  }
  return out;
}

export class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.listeners = new Set();
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data ?? '');
      for (const fn of [...this.listeners]) fn(line);
    };
    this.worker.onerror = (e) => {
      this.error = e.message || 'Engine failed to load';
      for (const fn of [...this.listeners]) fn('__error__');
    };
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(pred, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.listeners.delete(fn); reject(new Error('Engine timed out')); }, timeoutMs);
      const fn = (line) => {
        if (line === '__error__') { clearTimeout(timer); this.listeners.delete(fn); reject(new Error(this.error)); return; }
        if (pred(line)) { clearTimeout(timer); this.listeners.delete(fn); resolve(line); }
      };
      this.listeners.add(fn);
    });
  }

  async init() {
    const uciok = this.waitFor((l) => l === 'uciok', 30000);
    this.send('uci');
    await uciok;
    this.send('setoption name Hash value 32');
    this.send('setoption name MultiPV value 1');
    this.send('ucinewgame');
    const ready = this.waitFor((l) => l === 'readyok', 30000);
    this.send('isready');
    await ready;
  }

  /**
   * Evaluates a position. Score is from the side to move's point of view.
   * @returns {Promise<{ best: string|null, cp?: number, mate?: number, pv: string[], depth: number }>}
   */
  async analyse(fen, { depth = 15, movetime } = {}) {
    let exact = null;
    let any = null;
    const onInfo = (line) => {
      if (!line.startsWith('info ') || !line.includes(' score ')) return;
      const p = parseInfo(line);
      if (p.multipv && p.multipv !== 1) return;
      any = p;
      if (!p.bound) exact = p;
    };
    this.listeners.add(onInfo);
    try {
      // Register the waiter before sending: some engine builds reply synchronously.
      const done = this.waitFor((l) => l.startsWith('bestmove'), (movetime || 30000) + 30000);
      this.send('position fen ' + fen);
      this.send(`go depth ${depth}` + (movetime ? ` movetime ${movetime}` : ''));
      const bm = await done;
      const best = bm.split(/\s+/)[1];
      const info = exact || any || {};
      const pv = info.pv?.length ? info.pv : best && best !== '(none)' ? [best] : [];
      return { best: best && best !== '(none)' ? best : null, cp: info.cp, mate: info.mate, pv, depth: info.depth || 0 };
    } finally {
      this.listeners.delete(onInfo);
    }
  }

  stop() {
    this.send('stop');
  }

  terminate() {
    this.worker.terminate();
  }
}
