// Replaces any PNG still under assets/cards with a phone-sized WebP (600px wide,
// the in-game card is at most 300 CSS px) and deletes the PNG.
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets', 'cards');
const MAX_WIDTH = 600;
const QUALITY = 75;

function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name.toLowerCase().endsWith('.png')) acc.push(full);
  }
  return acc;
}

const files = walk(SRC);
if (!files.length) {
  console.log('No PNGs under assets/cards.');
  process.exit(0);
}

const cwebp = which('cwebp');
const magick = which('magick');
if (!cwebp && !magick) {
  console.error('Need cwebp or ImageMagick (magick) on PATH.');
  process.exit(1);
}

function pngWidth(src) {
  const r = spawnSync('sips', ['-g', 'pixelWidth', src], { encoding: 'utf8' });
  const m = r.stdout.match(/pixelWidth:\s*(\d+)/);
  return m ? Number(m[1]) : MAX_WIDTH + 1;
}

function convert(src, dest) {
  const shrink = pngWidth(src) > MAX_WIDTH;
  if (cwebp) {
    const args = ['-quiet', '-q', String(QUALITY)];
    if (shrink) args.push('-resize', String(MAX_WIDTH), '0');
    args.push(src, '-o', dest);
    const r = spawnSync(cwebp, args, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`cwebp failed: ${src}`);
    return;
  }
  const args = shrink ? [src, '-resize', `${MAX_WIDTH}x`, '-quality', String(QUALITY), dest]
    : [src, '-quality', String(QUALITY), dest];
  const r = spawnSync(magick, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`magick failed: ${src}`);
}

let bytesIn = 0;
let bytesOut = 0;
for (const src of files) {
  const dest = src.replace(/\.png$/i, '.webp');
  convert(src, dest);
  bytesIn += statSync(src).size;
  bytesOut += statSync(dest).size;
  unlinkSync(src);
}

function mb(n) { return (n / 1e6).toFixed(2); }
console.log(`Replaced ${files.length} PNGs in assets/cards (${mb(bytesIn)} MB → ${mb(bytesOut)} MB WebP).`);
