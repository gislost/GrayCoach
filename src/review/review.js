// Review page: engine analysis (Stockfish in a Worker), board + graph + move list, Claude coach.
import { Chessground } from 'chessground';
import { buildGame, movePrefix, uciLineToSan, formatLine } from '../lib/game.js';
import { Engine } from '../lib/engine.js';
import { analysePositions, gradeGame, CLASSES, BAD, wpWhite, formatEval } from '../lib/analysis.js';
import { buildGameReport, getReview, askCoach } from '../lib/coach.js';
import { getSettings, MODELS } from '../lib/settings.js';
import { loadGame, loadReview, saveReview, saveGame } from '../lib/store.js';
import { assetURL, openOptions, storageSet } from '../lib/ext.js';
import { colorOf } from '../lib/pgn.js';
import { linkMoves, linkMoveAt, startsWithSan } from '../lib/movelinks.js';

const CACHE_VERSION = 1;
const $ = (id) => document.getElementById(id);

// Hex colors for the classification labels drawn on the board (SVG can't read CSS variables).
const LABEL_FILL = { best: '#5fb85f', forced: '#7d8590', inaccuracy: '#d4a72c', mistake: '#e8772e', blunder: '#e5484d' };

const S = {
  key: null,
  rec: null,
  game: null,
  settings: null,
  cache: null, // { version, depth, evals, createdAt, coach?, coachModel?, coachFor?, chat? }
  evals: [],
  graded: null,
  cur: 0,
  orientation: 'white',
  playerColor: null,
  showBetter: false,
  hint: null, // { uci, label }: a move the coach suggested, drawn as an arrow
  analysing: false,
  coachBusy: false,
  coachError: null,
  chatBusy: false,
  cg: null,
};

// ---------- small helpers ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inlineMd(s) {
  return esc(s)
    .replace(/^#{1,4}\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Tiny, safe markdown: paragraphs, "- " bullets, **bold**, `code`. Everything is escaped first. */
function md(text) {
  return String(text)
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => {
      let html = '';
      let para = [];
      let list = [];
      const flushP = () => { if (para.length) { html += `<p>${para.map(inlineMd).join('<br>')}</p>`; para = []; } };
      const flushL = () => { if (list.length) { html += `<ul>${list.map((x) => `<li>${inlineMd(x)}</li>`).join('')}</ul>`; list = []; } };
      for (const line of block.split('\n')) {
        const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
        // "6. cxd4 was good" is a move, not a numbered list item.
        if (m && !(/^\s*\d/.test(line) && startsWithSan(m[1]))) { flushP(); list.push(m[1]); } else { flushL(); if (line.trim()) para.push(line); }
      }
      flushP();
      flushL();
      return html;
    })
    .join('');
}

// Coach text with clickable moves.
const coachMd = (s) => linkMoves(md(s), S.game);
const coachInline = (s) => linkMoves(inlineMd(s), S.game);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const colorName = (c) => (c === 'w' || c === 'white' ? 'White' : 'Black');
const cgColor = (turn) => (turn === 'w' ? 'white' : 'black');
const header = (k) => {
  const v = S.game?.headers?.[k];
  return v && v !== '?' && v !== '????.??.??' ? v : '';
};
const modelLabel = (id) => (MODELS.find((m) => m.id === id)?.label.replace(/\s*\(.*\)$/, '') || id || 'Claude');

function fatal(msg) {
  const el = $('fatal');
  el.textContent = msg;
  el.hidden = false;
}

// ---------- paste flow ----------
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function showPaste() {
  document.title = 'Paste a game · GrayCoach';
  $('pastePanel').hidden = false;
  $('pasteLink').hidden = true;
  const input = $('pgnInput');
  const err = $('pasteError');
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };

  const peekResult = () => {
    const m = input.value.match(/\[Result\s+"([^"]*)"\]/);
    const tail = input.value.trim().match(/(1-0|0-1|1\/2-1\/2|\*)\s*$/);
    return m ? m[1] : tail ? tail[1] : null;
  };
  input.addEventListener('input', () => {
    const r = peekResult();
    $('unfinishedBox').hidden = !(input.value.trim() && (r === '*' || r === null));
  });

  $('pasteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showErr('');
    const pgn = input.value.trim();
    if (!pgn) return showErr('Paste a PGN first.');
    let g;
    try {
      g = buildGame({ pgn });
    } catch (ex) {
      return showErr(`Couldn't read that PGN: ${ex.message}`);
    }
    if (!g.plies.length) return showErr('No moves found in that PGN.');
    const result = g.headers.Result;
    if (!result || result === '*') {
      $('unfinishedBox').hidden = false;
      if (!$('unfinishedOk').checked) return showErr('This game has no result. Tick the box above if it is over.');
    }
    const sel = $('pasteColor').value;
    const settings = await getSettings();
    const playerColor = sel !== 'auto' ? sel : colorOf(settings.chesscomUser, g.headers) || colorOf(settings.lichessUser, g.headers);
    const site = String(g.headers.Site || '');
    const key = await saveGame({
      site: 'paste',
      id: hashString(pgn),
      url: /^https?:\/\//.test(site) ? site : '',
      pgn,
      headers: g.headers,
      playerColor: playerColor || null,
    });
    location.href = 'review.html?g=' + encodeURIComponent(key);
  });
  input.focus();
}

// ---------- header / tags ----------
function renderTitle() {
  const w = header('White') || 'White';
  const b = header('Black') || 'Black';
  const res = header('Result');
  const date = header('Date') || header('UTCDate');
  const site = S.rec.site === 'paste' ? 'pasted PGN' : S.rec.site;
  document.title = `${w} vs ${b} · Game review`;
  const parts = [`${w} vs ${b}`, res, date, site].filter(Boolean).map(esc);
  $('gameTitle').innerHTML = parts.join(' · ') + (S.rec.url ? ` · <a href="${esc(S.rec.url)}" target="_blank" rel="noopener">open game ↗</a>` : '');
}

function renderTags() {
  const tag = (color) => {
    const c = color === 'white' ? 'w' : 'b';
    const name = header(colorName(c)) || colorName(c);
    const elo = header(colorName(c) + 'Elo');
    const acc = S.graded?.accuracy[c];
    return `<span class="swatch ${c}"></span><span>${esc(name)}</span>` +
      (elo ? `<span class="elo">(${esc(elo)})</span>` : '') +
      (S.playerColor === color ? '<span class="you">you</span>' : '') +
      (acc != null ? `<span class="acc">${acc.toFixed(1)}% accuracy</span>` : '');
  };
  const bottom = S.orientation;
  const top = bottom === 'white' ? 'black' : 'white';
  $('tagTop').innerHTML = tag(top);
  $('tagBottom').innerHTML = tag(bottom);
}

// ---------- board ----------
function gradedMove(i) {
  return i > 0 ? S.graded?.moves[i - 1] || null : null;
}

function arrow(uci, brush) {
  return uci && uci.length >= 4 ? { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush } : null;
}

function renderBoard() {
  const g = S.game;
  const i = S.cur;
  const ply = i > 0 ? g.plies[i - 1] : null;
  const m = gradedMove(i);
  let shapes = [];

  if (S.showBetter && m && m.bestUci) {
    const pos = g.positions[i - 1];
    S.cg.set({ fen: pos.fen, turnColor: cgColor(pos.turn), check: pos.inCheck, lastMove: undefined });
    shapes = [arrow(m.uci, 'red'), arrow(m.bestUci, 'green')];
  } else {
    const pos = g.positions[i];
    S.cg.set({ fen: pos.fen, turnColor: cgColor(pos.turn), check: pos.inCheck, lastMove: ply ? [ply.from, ply.to] : undefined });
    if (m && LABEL_FILL[m.cls]) shapes.push({ orig: ply.to, label: { text: CLASSES[m.cls].glyph, fill: LABEL_FILL[m.cls] } });
    if ($('arrowToggle').checked && S.evals[i]?.best) shapes.push(arrow(S.evals[i].best, 'paleBlue'));
    if (S.hint) shapes.push(arrow(S.hint.uci, 'green'));
  }
  S.cg.setAutoShapes(shapes.filter(Boolean));
}

function renderEvalBar() {
  const shownIdx = S.showBetter && S.cur > 0 ? S.cur - 1 : S.cur;
  const ev = S.evals[shownIdx];
  const bar = $('evalbar');
  const fill = $('evalFill');
  const text = $('evalText');
  const wp = ev ? wpWhite(ev) : 0.5;
  fill.style.height = `${(wp * 100).toFixed(1)}%`;
  bar.classList.toggle('flipped', S.orientation === 'black');
  text.textContent = ev ? formatEval(ev).replace(/^\+/, '') : '';
  // Put the number on the side that is better, in that side's color.
  const whiteBetter = wp >= 0.5;
  const whiteAtBottom = S.orientation === 'white';
  const atBottom = whiteBetter === whiteAtBottom;
  text.className = 'evalbar-text ' + (atBottom ? 'at-bottom' : 'at-top');
  text.style.color = whiteBetter ? '#333' : '#eee';
}

// ---------- move info ----------
function renderMoveInfo() {
  const el = $('moveInfo');
  const i = S.cur;
  const g = S.game;
  const hintNote = S.hint && !S.showBetter
    ? `<p class="hint-note"><span class="hint-arrow">➚</span> Green arrow: <strong>${esc(S.hint.label)}</strong>, the coach's suggestion (not played).</p>`
    : '';
  if (i === 0) {
    const ev = S.evals[0];
    el.innerHTML = `<div class="headline"><span class="san">Start position</span>${ev ? `<span class="ev">${esc(formatEval(ev))}</span>` : ''}</div>
      ${hintNote || '<p class="muted small">Use ← → (or click a move, the graph, or a key moment) to step through the game.</p>'}`;
    return;
  }
  const ply = g.plies[i - 1];
  const m = gradedMove(i);
  const label = `${movePrefix(ply)} ${ply.san}`;
  if (!m) {
    const ev = S.evals[i];
    el.innerHTML = `<div class="headline"><span class="san">${esc(label)}</span>${ev ? `<span class="ev">${esc(formatEval(ev))}</span>` : ''}</div>
      <p class="muted small">${S.analysing ? 'Grades appear when the engine finishes.' : ''}</p>${hintNote}`;
    return;
  }
  const cls = CLASSES[m.cls];
  let body = '';
  if (m.cls === 'best') body = '<p>The engine\'s top choice.</p>';
  else if (m.cls === 'forced') body = '<p>The only legal move.</p>';
  else if (m.bestSan && m.bestUci !== m.uci) {
    body = `<p>Best was <strong>${esc(m.bestSan)}</strong>${BAD.has(m.cls) ? ` (lost ${Math.round(m.loss * 100)}% winning chances)` : ''}.</p>` +
      (m.bestLine ? `<p class="line">${esc(m.bestLine)}</p>` : '');
  }
  if (m.missed) body += '<p class="cls-missed">Missed chance: the opponent\'s previous move was a mistake that this move didn\'t punish.</p>';
  const canShow = m.bestUci && m.bestUci !== m.uci && m.cls !== 'forced';
  el.innerHTML = `<div class="headline">
      <span class="san">${esc(label)}</span>
      <span class="badge cls-${m.cls}">${esc(cls.label)}${cls.glyph ? ' ' + esc(cls.glyph) : ''}</span>
      <span class="ev">${esc(formatEval(m.evalBefore))} → ${esc(formatEval(m.evalAfter))}</span>
    </div>${body}${hintNote}` +
    (canShow ? `<div class="actions"><button type="button" id="betterBtn">${S.showBetter ? 'Back to the game' : 'Show the better move'}</button></div>` : '');
  if (canShow) {
    $('betterBtn').addEventListener('click', () => {
      S.showBetter = !S.showBetter;
      renderBoard();
      renderEvalBar();
      renderMoveInfo();
    });
  }
}

// ---------- move list ----------
function renderMoveList() {
  const g = S.game;
  const out = [];
  let k = 0;
  const cell = (i) => {
    const ply = g.plies[i - 1];
    const m = gradedMove(i);
    const glyph = m && CLASSES[m.cls].glyph && m.cls !== 'forced' ? CLASSES[m.cls].glyph : '';
    const missed = m?.missed ? '<span class="glyph cls-missed" title="Missed chance">✗</span>' : '';
    const title = m ? `${CLASSES[m.cls].label} · ${formatEval(m.evalAfter)}` : '';
    return `<div class="mv${i === S.cur ? ' cur' : ''}" data-i="${i}" title="${esc(title)}">
      <span class="${m ? 'cls-' + m.cls : ''}">${esc(ply.san)}</span>${glyph ? `<span class="glyph cls-${m.cls}">${esc(glyph)}</span>` : ''}${missed}</div>`;
  };
  while (k < g.plies.length) {
    const p = g.plies[k];
    out.push(`<div class="no">${p.moveNo}.</div>`);
    if (p.color === 'b') {
      out.push('<div class="mv empty">…</div>', cell(k + 1));
      k += 1;
    } else {
      out.push(cell(k + 1));
      out.push(k + 1 < g.plies.length ? cell(k + 2) : '<div class="mv empty"></div>');
      k += 2;
    }
  }
  if (header('Result')) out.push(`<div class="result">${esc(header('Result'))}${header('Termination') ? ' · ' + esc(header('Termination')) : ''}</div>`);
  $('moves').innerHTML = out.join('');
}

function highlightMove() {
  const box = $('moves');
  box.querySelectorAll('.mv.cur').forEach((n) => n.classList.remove('cur'));
  const el = box.querySelector(`.mv[data-i="${S.cur}"]`);
  if (!el) return;
  el.classList.add('cur');
  const c = box.parentElement;
  if (el.offsetTop < c.scrollTop || el.offsetTop + el.offsetHeight > c.scrollTop + c.clientHeight) {
    c.scrollTop = el.offsetTop - c.clientHeight / 2;
  }
}

// ---------- eval graph ----------
function renderGraph() {
  const svg = $('graph');
  const W = Math.max(200, Math.round(svg.clientWidth || 600));
  const H = 120;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const n = S.game.plies.length;
  const x = (i) => (n ? (i / n) * W : 0);
  const y = (ev) => (1 - wpWhite(ev)) * H;
  let d = '';
  let lastX = 0;
  for (let i = 0; i <= n; i++) {
    const ev = S.evals[i];
    if (!ev) break;
    d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(ev).toFixed(1)} `;
    lastX = x(i);
  }
  const area = d ? `<path class="area" d="M0,${H} ${d.replace(/^M/, 'L')}L${lastX.toFixed(1)},${H} Z"/>` : '';
  let dots = '';
  if (S.graded) {
    for (const m of S.graded.moves) {
      if (m.cls !== 'mistake' && m.cls !== 'blunder' && !m.missed) continue;
      const fill = m.cls === 'blunder' ? LABEL_FILL.blunder : m.cls === 'mistake' ? LABEL_FILL.mistake : '#b083f0';
      dots += `<circle class="dot" cx="${x(m.ply).toFixed(1)}" cy="${y(m.evalAfter).toFixed(1)}" r="4" fill="${fill}"><title>${esc(`${movePrefix(m)} ${m.san}: ${CLASSES[m.cls].label}`)}</title></circle>`;
    }
  }
  const cx = x(S.cur).toFixed(1);
  svg.innerHTML = `<rect class="bg" x="0" y="0" width="${W}" height="${H}"/>${area}
    <line class="mid" x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
    <line class="cur" x1="${cx}" y1="0" x2="${cx}" y2="${H}"/>${dots}`;
}

// ---------- navigation ----------
function show(i, hint = null) {
  S.cur = clamp(i, 0, S.game.plies.length);
  S.showBetter = false;
  S.hint = hint;
  renderBoard();
  renderEvalBar();
  renderMoveInfo();
  highlightMove();
  renderGraph();
  markCurrent();
}

/** Highlights the key moment and the coach-text moves that match the board. */
function markCurrent() {
  document.querySelectorAll('.moment').forEach((n) => n.classList.toggle('active', +n.dataset.ply === S.cur));
  document.querySelectorAll('.mvlink').forEach((n) => {
    const on = n.classList.contains('alt')
      ? S.hint && +n.dataset.ply === S.cur && n.dataset.uci === S.hint.uci
      : !S.hint && +n.dataset.ply === S.cur;
    n.classList.toggle('cur', !!on);
  });
}

function setOrientation(o) {
  S.orientation = o;
  S.cg.set({ orientation: o });
  renderTags();
  renderEvalBar();
}

// ---------- summary ----------
function renderSummary() {
  const el = $('summaryCard');
  if (!S.graded) { el.hidden = true; return; }
  el.hidden = false;
  const { accuracy, acpl, counts } = S.graded;
  const fmtAcc = (v) => (v == null ? '–' : v.toFixed(1));
  const rows = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']
    .map((k) => `<tr><td class="cls-${k}">${esc(CLASSES[k].label)} ${esc(CLASSES[k].glyph)}</td><td>${counts.w[k] || 0}</td><td>${counts.b[k] || 0}</td></tr>`)
    .join('');
  const deeper = S.settings.depth > S.cache.depth;
  el.innerHTML = `
    <table>
      <thead><tr><th></th><th>${esc(header('White') || 'White')}</th><th>${esc(header('Black') || 'Black')}</th></tr></thead>
      <tbody>
        <tr><td>Accuracy</td><td class="acc-big">${fmtAcc(accuracy.w)}</td><td class="acc-big">${fmtAcc(accuracy.b)}</td></tr>
        <tr><td>Avg. centipawn loss</td><td>${Math.round(acpl.w ?? 0)}</td><td>${Math.round(acpl.b ?? 0)}</td></tr>
        ${rows}
        <tr><td class="cls-missed">Missed chances</td><td>${counts.w.missed || 0}</td><td>${counts.b.missed || 0}</td></tr>
      </tbody>
    </table>
    <div class="row who">
      <span class="muted">You played</span>
      <span class="seg" role="group" aria-label="Which side you played">
        <button type="button" data-color="white" aria-pressed="${S.playerColor === 'white'}">White</button>
        <button type="button" data-color="black" aria-pressed="${S.playerColor === 'black'}">Black</button>
      </span>
    </div>
    <div class="row depth-note small muted">
      <span>Stockfish 19 · depth ${S.cache.depth}</span>
      ${deeper ? `<button type="button" class="small" id="deeperBtn">Re-analyze at depth ${S.settings.depth}</button>` : ''}
    </div>`;
  el.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => setPlayerColor(b.dataset.color)));
  $('deeperBtn')?.addEventListener('click', () => runAnalysis());
}

async function setPlayerColor(c) {
  if (S.playerColor === c) return;
  S.playerColor = c;
  S.rec = { ...S.rec, playerColor: c };
  await storageSet({ [S.key]: S.rec });
  setOrientation(c);
  renderSummary();
  renderCoach();
}

// ---------- engine ----------
function setProgress(done, total, startedAt) {
  const pct = total ? (done / total) * 100 : 0;
  $('progressFill').style.width = `${pct.toFixed(1)}%`;
  let txt = `Analyzing with Stockfish… ${done}/${total} positions`;
  if (done > 2 && startedAt) {
    const per = (performance.now() - startedAt) / done;
    const left = Math.round((per * (total - done)) / 1000);
    if (left > 0) txt += ` · about ${left < 60 ? left + 's' : Math.ceil(left / 60) + ' min'} left`;
  }
  $('progressText').textContent = txt;
}

async function runAnalysis() {
  if (S.analysing) return;
  S.analysing = true;
  const depth = S.settings.depth;
  const card = $('progressCard');
  card.hidden = false;
  card.querySelector('.spinner').hidden = false;
  $('progressNote').textContent = 'Stockfish runs right here in your browser. Nothing is uploaded.';
  $('progressText').textContent = 'Starting Stockfish…';
  $('progressFill').style.width = '0%';
  const prevCache = S.cache;
  S.graded = null;
  S.evals = [];
  renderSummary();
  renderCoach();
  renderMoveList();
  show(S.cur);

  let engine;
  try {
    engine = new Engine(assetURL('engine/stockfish.js'));
    await engine.init();
    const startedAt = performance.now();
    const evals = await analysePositions(S.game.positions, engine, {
      depth,
      onProgress: (done, total, ev) => {
        S.evals = ev;
        setProgress(done, total, startedAt);
        renderGraph();
        if (done - 1 === S.cur) { renderEvalBar(); renderBoard(); renderMoveInfo(); }
      },
    });
    S.evals = evals;
    S.cache = {
      version: CACHE_VERSION,
      depth,
      evals,
      createdAt: Date.now(),
      // A deeper re-analysis keeps the coach review and chat; they were written from a slightly shallower pass.
      ...(prevCache?.coach ? { coach: prevCache.coach, coachModel: prevCache.coachModel, coachFor: prevCache.coachFor } : {}),
      chat: prevCache?.chat || [],
    };
    await saveReview(S.key, S.cache);
    card.hidden = true;
  } catch (e) {
    card.querySelector('.spinner').hidden = true;
    $('progressText').textContent = 'The engine stopped.';
    $('progressNote').innerHTML = `${esc(e.message || String(e))} <button type="button" id="retryEngine">Try again</button>`;
    $('retryEngine').addEventListener('click', () => runAnalysis());
    S.analysing = false;
    return;
  } finally {
    engine?.terminate();
  }
  S.analysing = false;
  onAnalysed();
}

function onAnalysed() {
  S.graded = gradeGame(S.game, S.evals);
  renderTags();
  renderSummary();
  renderMoveList();
  show(S.cur);
  renderCoach();
  renderChat();
  if (!S.cache.coach && S.settings.apiKey && S.settings.autoCoach) runCoach();
}

// ---------- coach ----------
function report() {
  return buildGameReport({
    game: S.game,
    graded: S.graded,
    playerColor: S.playerColor,
    depth: S.cache.depth,
    site: S.rec.site === 'paste' ? 'pasted PGN' : S.rec.site,
    url: S.rec.url,
  });
}

async function runCoach() {
  if (S.coachBusy || !S.graded) return;
  S.coachBusy = true;
  S.coachError = null;
  renderCoach();
  try {
    const { review, model } = await getReview({ apiKey: S.settings.apiKey, model: S.settings.model, report: report() });
    S.cache = { ...S.cache, coach: review, coachModel: model, coachFor: S.playerColor || null, chat: [] };
    await saveReview(S.key, S.cache);
  } catch (e) {
    S.coachError = e.message || String(e);
  }
  S.coachBusy = false;
  renderCoach();
  renderChat();
}

function plyLabel(ply) {
  const p = S.game.plies[ply - 1];
  return p ? `${movePrefix(p)} ${p.san}` : '';
}

function renderCoach() {
  const el = $('coachCard');
  const s = S.settings;
  if (S.coachBusy) {
    el.innerHTML = `<h3>Coach review</h3><div class="loading"><span class="spinner"></span>
      <span>${esc(modelLabel(s.model))} is reviewing your game. This usually takes under a minute.</span></div>`;
    return;
  }
  if (!S.graded) {
    el.innerHTML = '<h3>Coach review</h3><p class="muted">The coach review starts when the engine finishes.</p>';
    return;
  }
  const r = S.cache?.coach;
  if (!r) {
    if (!s.apiKey) {
      el.innerHTML = `<h3>Coach review</h3>
        <p>Add your Anthropic API key in Settings to get a written review and tips from Claude.</p>
        <button type="button" class="primary" id="coachSettings">Open settings</button>`;
      $('coachSettings').addEventListener('click', openOptions);
      return;
    }
    el.innerHTML = `<h3>Coach review</h3>
      ${S.coachError ? `<div class="msg err">${esc(S.coachError)}</div><p></p>` : ''}
      <p class="muted">${esc(modelLabel(s.model))} reads the engine analysis and writes a review with key moments and tips. One API call on your key.</p>
      <button type="button" class="primary" id="coachRun">${S.coachError ? 'Try again' : 'Get coach review'}</button>`;
    $('coachRun').addEventListener('click', runCoach);
    return;
  }

  const moments = (r.key_moments || [])
    .map((m) => {
      const ply = clamp(Math.round(m.ply), 1, S.game.plies.length);
      const gm = S.graded.moves[ply - 1];
      return `<div class="moment" data-ply="${ply}" tabindex="0" role="button">
        <div><span class="m-move ${gm ? 'cls-' + gm.cls : 'muted'}">${esc(plyLabel(ply))}</span><span class="m-title">${esc(m.title)}</span></div>
        <div>${coachInline(m.explanation)}</div>
        ${m.better_move ? `<div class="small"><strong>Better:</strong> ${linkMoveAt(m.better_move, ply, S.game) ?? coachInline(m.better_move)}</div>` : ''}
        <div class="lesson">${coachInline(m.lesson)}</div>
      </div>`;
    })
    .join('');
  const list = (arr) => `<ul>${(arr || []).map((x) => `<li>${coachInline(x)}</li>`).join('')}</ul>`;
  const otherSide = r && S.cache.coachFor && S.playerColor && S.cache.coachFor !== S.playerColor;
  el.innerHTML = `
    ${otherSide ? `<div class="msg">This review was written for ${esc(colorName(S.cache.coachFor))}. <button type="button" id="coachSwitch">Re-run for ${esc(colorName(S.playerColor))}</button></div><p></p>` : ''}
    <h2>${linkMoves(esc(r.headline), S.game)}</h2>
    ${coachMd(r.summary)}
    <div class="phase"><strong>Opening</strong> ${coachInline(r.opening)}</div>
    <div class="phase"><strong>Middlegame</strong> ${coachInline(r.middlegame)}</div>
    ${r.endgame ? `<div class="phase"><strong>Endgame</strong> ${coachInline(r.endgame)}</div>` : ''}
    <h3>Key moments</h3>${moments}
    <h3>What went well</h3>${list(r.strengths)}
    <h3>What to fix</h3>${list(r.weaknesses)}
    <h3>Tips</h3>${(r.tips || []).map((t) => `<div class="tip"><strong>${linkMoves(esc(t.title), S.game)}</strong>${coachInline(t.detail)}</div>`).join('')}
    <h3>Train next</h3><div class="focus">${coachInline(r.training_focus)}</div>
    ${S.coachError ? `<div class="msg err" style="margin-top:12px">${esc(S.coachError)}</div>` : ''}
    <div class="row coach-foot small muted">
      <span>Coach: ${esc(modelLabel(S.cache.coachModel))}</span><span class="spacer"></span>
      <button type="button" class="ghost small" id="coachRerun">Re-run review</button>
    </div>`;
  el.querySelectorAll('.moment').forEach((n) => {
    const go = () => show(+n.dataset.ply);
    n.addEventListener('click', (e) => { if (!e.target.closest('.mvlink')) go(); });
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  $('coachRerun').addEventListener('click', () => {
    if (!s.apiKey) return openOptions();
    runCoach();
  });
  $('coachSwitch')?.addEventListener('click', runCoach);
  markCurrent();
}

// ---------- chat ----------
function positionContext() {
  const i = S.cur;
  const g = S.game;
  const pos = g.positions[i];
  const ev = S.evals[i];
  const lines = [];
  if (i === 0) lines.push(`Start position, ${colorName(pos.turn)} to move.`);
  else {
    const m = gradedMove(i);
    lines.push(`After ${plyLabel(i)} (ply ${i}), ${colorName(pos.turn)} to move.`);
    if (m) {
      let mv = `That move was graded ${CLASSES[m.cls].label.toLowerCase()} (eval ${formatEval(m.evalBefore)} → ${formatEval(m.evalAfter)}).`;
      if (m.bestSan && m.bestUci !== m.uci) mv += ` Engine preferred ${m.bestSan}${m.bestLine ? ` (${m.bestLine})` : ''}.`;
      lines.push(mv);
    }
  }
  lines.push(`FEN: ${pos.fen}`);
  if (ev) {
    lines.push(`Engine eval here: ${formatEval(ev)} (White's point of view).`);
    const sans = uciLineToSan(pos.fen, ev.pv, 8);
    if (sans.length) lines.push(`Engine's best line from here: ${formatLine(pos.fen, sans)}`);
  }
  if (S.showBetter) lines.push('(The student is looking at the "better move" view for this move.)');
  return lines.join('\n');
}

function renderChat() {
  const card = $('chatCard');
  card.hidden = !(S.graded && S.settings.apiKey);
  if (card.hidden) return;
  const chat = S.cache?.chat || [];
  $('chatLog').innerHTML = chat
    .map((t) => (t.role === 'user'
      ? `<div class="bubble user"><div class="ctx">${esc(t.at || '')}</div>${esc(t.q || t.content)}</div>`
      : `<div class="bubble assistant">${coachMd(t.content)}</div>`))
    .join('') + (S.chatBusy ? '<div class="bubble assistant"><span class="spinner"></span></div>' : '');
  const log = $('chatLog');
  log.scrollTop = log.scrollHeight;
  $('chatSend').disabled = S.chatBusy;
  $('chatClear').hidden = !chat.length;
  markCurrent();
}

async function sendChat(question) {
  if (S.chatBusy || !question.trim()) return;
  const chat = S.cache.chat || (S.cache.chat = []);
  const at = S.cur ? `at ${plyLabel(S.cur)}` : 'at the start';
  S.chatBusy = true;
  const pending = { role: 'user', content: '', q: question, at };
  chat.push(pending);
  renderChat();
  try {
    const history = chat.slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
    const { text, userTurn } = await askCoach({
      apiKey: S.settings.apiKey,
      model: S.settings.model,
      report: report(),
      review: S.cache.coach || null,
      history,
      question,
      positionContext: positionContext(),
    });
    pending.content = userTurn;
    chat.push({ role: 'assistant', content: text });
    await saveReview(S.key, S.cache);
    $('chatInput').value = '';
  } catch (e) {
    chat.pop(); // drop the unanswered question; it stays in the input box
    S.chatBusy = false;
    renderChat();
    $('chatLog').insertAdjacentHTML('beforeend', `<div class="msg err">${esc(e.message || String(e))}</div>`);
    return;
  }
  S.chatBusy = false;
  renderChat();
}

// ---------- startup ----------
function bindUi() {
  $('btnFirst').addEventListener('click', () => show(0));
  $('btnPrev').addEventListener('click', () => show(S.cur - 1));
  $('btnNext').addEventListener('click', () => show(S.cur + 1));
  $('btnLast').addEventListener('click', () => show(S.game.plies.length));
  $('btnFlip').addEventListener('click', () => setOrientation(S.orientation === 'white' ? 'black' : 'white'));
  $('arrowToggle').addEventListener('change', renderBoard);
  $('moves').addEventListener('click', (e) => {
    const mv = e.target.closest('.mv[data-i]');
    if (mv) show(+mv.dataset.i);
  });
  // Moves in the coach's text: jump there; a move that wasn't played shows as an arrow.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.mvlink');
    if (!a) return;
    e.preventDefault();
    show(+a.dataset.ply, a.dataset.uci ? { uci: a.dataset.uci, label: a.dataset.label } : null);
    const b = $('board').getBoundingClientRect();
    if (b.bottom < 60 || b.top > innerHeight - 60) $('board').scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  $('graph').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    show(Math.round(((e.clientX - r.left) / r.width) * S.game.plies.length));
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowLeft') show(S.cur - 1);
    else if (k === 'ArrowRight') show(S.cur + 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(S.game.plies.length);
    else if (k === 'f' || k === 'F') setOrientation(S.orientation === 'white' ? 'black' : 'white');
    else return;
    e.preventDefault();
  });
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat($('chatInput').value);
  });
  $('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat($('chatInput').value); }
  });
  $('chatClear').addEventListener('click', async () => {
    S.cache.chat = [];
    await saveReview(S.key, S.cache);
    renderChat();
  });
  new ResizeObserver(() => {
    document.body.dispatchEvent(new Event('chessground.resize'));
    renderGraph();
  }).observe($('board'));
  // Settings may change in another tab (API key added, model switched).
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(async (changes) => {
      if (!changes.settings) return;
      S.settings = await getSettings();
      renderSummary();
      renderCoach();
      renderChat();
    });
  }
}

/** Side panel, before the game arrives: "Loading the game…" or why it couldn't load. */
function panelWaiting(error) {
  const el = $('fatal');
  el.hidden = false;
  if (error) {
    el.className = 'msg err';
    el.textContent = error;
    return;
  }
  el.className = 'msg panel-wait';
  el.innerHTML = '<span class="spinner"></span> <span>Loading the game…</span>';
  setTimeout(() => {
    el.lastElementChild.textContent = 'Still loading… If nothing happens, click Coach review on the game again.';
  }, 30000);
}

async function main() {
  $('settingsBtn').addEventListener('click', openOptions);
  const params = new URLSearchParams(location.search);
  // ?panel=1: shown in the browser's side panel next to the chess site (see background.js).
  const inPanel = params.has('panel');
  document.body.classList.toggle('in-panel', inPanel);
  S.settings = await getSettings();
  const key = params.get('g');
  if (inPanel) {
    $('pasteLink').hidden = true;
    if (!key) return panelWaiting(params.get('error'));
    const pop = $('popOut');
    pop.href = 'review.html?g=' + encodeURIComponent(key);
    pop.hidden = false;
  }
  if (params.has('paste') || !key) return showPaste();

  const rec = await loadGame(key);
  if (!rec) return fatal("This game isn't saved anymore (the extension keeps your 40 most recent games). Open it again from chess.com or Lichess.");
  S.key = key;
  S.rec = rec;
  try {
    S.game = buildGame(rec);
  } catch (e) {
    return fatal(`Couldn't load this game: ${e.message}`);
  }
  if (!S.game.plies.length) return fatal('This game has no moves to review.');

  S.playerColor = rec.playerColor || null;
  S.orientation = S.playerColor || 'white';
  $('reviewPanel').hidden = false;
  S.cg = Chessground($('board'), {
    fen: S.game.positions[0].fen,
    orientation: S.orientation,
    viewOnly: true,
    coordinates: true,
    animation: { enabled: true, duration: 160 },
    highlight: { lastMove: true, check: true },
    drawable: { enabled: false, visible: true },
  });
  bindUi();
  renderTitle();
  renderTags();
  renderMoveList();
  renderCoach();

  const cached = await loadReview(key);
  if (cached?.version === CACHE_VERSION && cached.evals?.length === S.game.positions.length) {
    S.cache = cached;
    S.evals = cached.evals;
    $('progressCard').hidden = true;
    onAnalysed();
  } else {
    show(0);
    runAnalysis();
  }
}

main().catch((e) => fatal(e.message || String(e)));
