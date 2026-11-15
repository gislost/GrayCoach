// Makes the Chrome Web Store images from the real build: screenshots (1280x800) of an actual
// Stockfish review, the settings page, and the 440x280 promo tile.
//   npm run build && npm run shots
// Uses headless Edge or Chrome over the DevTools protocol (set EDGE=<path> to pick a browser).
// No API key is set, so no Claude calls are made.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Paul Morphy vs Duke Karl / Count Isouard, Paris 1858 (the "Opera Game"), reviewed from Black's side.
const PGN = `[Event "Opera Game"]
[Site "Paris"]
[Date "1858.11.02"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const PROMO = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:440px;height:280px;overflow:hidden}
  body{font-family:"Segoe UI",system-ui,sans-serif;color:#e6edf3;
    background:radial-gradient(120% 140% at 0% 0%,#1d2a22 0%,#0f1216 55%);display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box}
  img{width:112px;height:112px;image-rendering:auto;flex:none;filter:drop-shadow(0 6px 18px #0008)}
  h1{font-size:38px;line-height:1.05;margin:0 0 10px;font-weight:800;letter-spacing:-.015em}
  p{margin:0;font-size:15px;line-height:1.35;color:#b8c2cc}
  .tag{margin-top:14px;font-size:12.5px;color:#3fb950;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
</style><img src="/icons/icon128.png" alt=""><div><h1>GrayCoach</h1>
<p>Stockfish grades every move. Claude explains what went wrong and what to train next.</p>
<div class="tag">chess.com · Lichess</div></div>`;

// ---- static server for dist/ ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/__promo.html') return res.writeHead(200, { 'content-type': MIME['.html'] }).end(PROMO);
  const file = path.join(DIST, p);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- headless browser ----
function findBrowser() {
  const candidates = [
    process.env.EDGE, process.env.CHROME,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
  ];
  const found = candidates.find((c) => c && fs.existsSync(c));
  if (!found) throw new Error('No Edge/Chrome found. Set EDGE=<path to browser>.');
  return found;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gcc-shots-'));
const browser = spawn(findBrowser(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-extensions', 'about:blank',
], { stdio: 'ignore' });

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }
  async open() {
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('DevTools connection failed')); });
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message));
        else p.res(msg.result);
      } else for (const l of this.listeners) l(msg);
    };
    return this;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  once(method) {
    return new Promise((res) => {
      const l = (m) => { if (m.method === method) { this.listeners.delete(l); res(m.params); } };
      this.listeners.add(l);
    });
  }
}

let port;
for (let t = 0; t < 100 && !port; t++) {
  try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch { await sleep(150); }
}
if (!port) throw new Error('The browser did not start.');
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = await new CDP(targets.find((t) => t.type === 'page').webSocketDebuggerUrl).open();
await page.send('Page.enable');
await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });

async function evaluate(expression) {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(expression)) return;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
async function navigate(url, action) {
  const loaded = page.once('Page.loadEventFired');
  if (action) await evaluate(action);
  else await page.send('Page.navigate', { url });
  await loaded;
}
// Lays the page out at width x height CSS px, saves it scaled to outW px wide.
async function viewport(width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}
async function shot(name, width, height, outW) {
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png', clip: { x: 0, y: 0, width, height, scale: outW / width },
  });
  const file = path.join(OUT, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('  wrote', path.relative(ROOT, file));
}

try {
  // Laid out at 1440x900 (three-column review) and saved at the store's 1280x800.
  const W = 1440, H = 900;
  await viewport(W, H);
  await navigate(`${BASE}/review/review.html?paste=1`);
  await navigate(null, `(() => {
    document.getElementById('pgnInput').value = ${JSON.stringify(PGN)};
    document.getElementById('pasteColor').value = 'black';
    document.getElementById('pasteForm').requestSubmit();
  })()`);
  console.log('  analysing with Stockfish…');
  await waitFor(`document.getElementById('progressCard').hidden && !document.getElementById('summaryCard').hidden`, 300_000, 'the engine');

  const go = (ply) => evaluate(`document.querySelector('.mv[data-i="${ply}"]').click()`);

  await go(18); // 9...b5
  await sleep(300);
  await evaluate(`document.getElementById('betterBtn')?.click()`);
  await sleep(700);
  await shot('screenshots/1-review-mistake.png', W, H, 1280);

  await go(33); // 17.Rd8#
  await sleep(700);
  await shot('screenshots/2-review-final.png', W, H, 1280);

  await viewport(1280, 800);
  await navigate(`${BASE}/options/options.html`);
  await sleep(500);
  await shot('screenshots/3-settings.png', 1280, 800, 1280);

  await viewport(440, 280);
  await navigate(`${BASE}/__promo.html`);
  await sleep(300);
  await shot('promo-440x280.png', 440, 280, 440);

  fs.copyFileSync(path.join(DIST, 'icons/icon128.png'), path.join(OUT, 'icon-128.png'));
  console.log('  wrote store/icon-128.png');
} finally {
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    await (await new CDP(webSocketDebuggerUrl).open()).send('Browser.close');
  } catch { browser.kill(); }
  server.close();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
process.exit(0);
