// Builds the extension into dist/. Load dist/ as an unpacked extension.
//   npm run build        one-off build
//   npm run watch        rebuild on change
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const watch = process.argv.includes('--watch');
const OUT = 'dist';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function copy(from, to) {
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
  fs.copyFileSync(from, path.join(OUT, to));
}

function copyStatic() {
  copy('src/manifest.json', 'manifest.json');
  copy('LICENSE', 'LICENSE.txt');
  for (const f of ['review/review.html', 'review/review.css', 'options/options.html', 'popup/popup.html', 'ui.css']) {
    copy(path.join('src', f), f);
  }
  // Stockfish 19 lite, single-threaded: no SharedArrayBuffer / cross-origin isolation needed.
  copy('node_modules/stockfish/bin/stockfish-19-lite-single.js', 'engine/stockfish.js');
  copy('node_modules/stockfish/bin/stockfish-19-lite-single.wasm', 'engine/stockfish.wasm');
  copy('node_modules/stockfish/Copying.txt', 'engine/COPYING.txt');
  for (const f of ['base', 'brown', 'cburnett']) {
    copy(`node_modules/chessground/assets/chessground.${f}.css`, `review/cg/chessground.${f}.css`);
  }
  writeIcons();
}

// ---- tiny PNG icon generator (no image deps): a knight-ish board tile ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function iconPixel(u, v) {
  // rounded square, 4x4 board, with a magnifier ring in the corner
  const r = 0.18, inset = 0.04;
  const cx = Math.min(Math.max(u, inset + r), 1 - inset - r), cy = Math.min(Math.max(v, inset + r), 1 - inset - r);
  if (Math.hypot(u - cx, v - cy) > r) return [0, 0, 0, 0];
  const light = [240, 217, 181], dark = [181, 136, 99];
  const sq = (Math.floor(u * 4) + Math.floor(v * 4)) % 2 === 0 ? light : dark;
  const d = Math.hypot(u - 0.62, v - 0.6);
  if (d > 0.2 && d < 0.27) return [46, 160, 67, 255];
  if (d <= 0.2) return [...sq.map((c) => Math.round(c * 0.75 + 255 * 0.25)), 255];
  const h = Math.abs(u - 0.8 - (v - 0.8));
  if (u > 0.78 && v > 0.78 && u < 0.95 && v < 0.95 && h < 0.07) return [46, 160, 67, 255];
  return [...sq, 255];
}
function writeIcons() {
  fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
  for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(OUT, 'icons', `icon${s}.png`), png(s, iconPixel));
}

// ---- bundles ----
const common = { bundle: true, target: 'chrome120', logLevel: 'info', sourcemap: watch ? 'inline' : false, legalComments: 'none' };
const pages = {
  ...common,
  format: 'esm',
  outdir: OUT,
  outbase: 'src',
  entryPoints: ['src/background.js', 'src/review/review.js', 'src/options/options.js', 'src/popup/popup.js'],
};
// Content scripts can't be ES modules.
const content = {
  ...common,
  format: 'iife',
  outdir: OUT,
  outbase: 'src',
  entryPoints: ['src/content/chesscom.js', 'src/content/lichess.js'],
};

copyStatic();
if (watch) {
  const a = await esbuild.context(pages);
  const b = await esbuild.context(content);
  await Promise.all([a.watch(), b.watch()]);
  fs.watch('src', { recursive: true }, (_e, f) => {
    if (f && /\.(html|css|json)$/.test(f)) { try { copyStatic(); console.log('copied static', f); } catch (e) { console.error(e); } }
  });
  console.log('watching…');
} else {
  const results = await Promise.all([esbuild.build({ ...pages, metafile: true }), esbuild.build({ ...content, metafile: true })]);
  writeThirdPartyLicenses(results.flatMap((r) => Object.keys(r.metafile.inputs)));
}

// The bundles drop license comments, so ship every bundled package's license text alongside them.
function writeThirdPartyLicenses(inputs) {
  const roots = new Set();
  for (const f of inputs) {
    const m = f.replace(/\\/g, '/').match(/^(?:.*\/)?node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m) roots.add(m[1]);
  }
  roots.add('stockfish'); // copied as engine/, not bundled
  const parts = [];
  for (const name of [...roots].sort()) {
    const dir = path.join('node_modules', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
    const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : `License: ${pkg.license}`;
    parts.push(`${'='.repeat(78)}\n${name} ${pkg.version} (${pkg.license})\n${pkg.homepage || ''}\n${'='.repeat(78)}\n\n${text}\n`);
  }
  parts.push(
    `${'='.repeat(78)}\ncburnett chess pieces (CC BY-SA 3.0)\nhttps://commons.wikimedia.org/wiki/Category:SVG_chess_pieces\n${'='.repeat(78)}\n\n` +
      'Chess piece images by Colin M.L. Burnett, licensed under the Creative Commons\nAttribution-ShareAlike 3.0 Unported license: https://creativecommons.org/licenses/by-sa/3.0/\n',
  );
  const head = 'GrayCoach is licensed under the GNU GPL v3 or later.\nSource: https://github.com/gislost/GrayCoach\n\nThird-party software included in this build:\n\n';
  fs.writeFileSync(path.join(OUT, 'THIRD_PARTY_LICENSES.txt'), head + parts.join('\n'));
  console.log(`  ${OUT}/THIRD_PARTY_LICENSES.txt (${roots.size} packages)`);
}
