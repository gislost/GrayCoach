// Zips dist/ into release/graycoach-v<version>.zip, with manifest.json at the zip root
// (the layout the Chrome Web Store and "Load unpacked" after unzipping both expect).
//   npm run package      builds, then runs this
// No dependencies: a minimal zip writer (deflate, forward-slash paths, fixed timestamps so
// the same build gives the same zip).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = 'dist';
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
const out = path.join('release', `graycoach-v${manifest.version}.zip`);

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((d) => {
      const rel = base ? `${base}/${d.name}` : d.name;
      return d.isDirectory() ? walk(path.join(dir, d.name), rel) : [rel];
    });
}

// 2026-01-01 00:00 in MS-DOS format.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const local = [];
const central = [];
let offset = 0;
const files = walk(DIST);
for (const name of files) {
  const data = fs.readFileSync(path.join(DIST, name));
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const stored = deflated.length >= data.length;
  const body = stored ? data : deflated;
  const crc = zlib.crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt16LE(0x0800, 6); // UTF-8 names
  lh.writeUInt16LE(stored ? 0 : 8, 8);
  lh.writeUInt16LE(DOS_TIME, 10);
  lh.writeUInt16LE(DOS_DATE, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  local.push(lh, nameBuf, body);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4); // made by
  ch.writeUInt16LE(20, 6); // needed
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(stored ? 0 : 8, 10);
  ch.writeUInt16LE(DOS_TIME, 12);
  ch.writeUInt16LE(DOS_DATE, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  // extra len, comment len, disk start, internal attrs, external attrs: all 0
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + body.length;
}

const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([...local, cd, end]));
console.log(`${out}: ${files.length} files, ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
