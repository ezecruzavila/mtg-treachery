// Build-time script: walks assets/cards on disk and writes dist/cards-manifest.json
// shaped as index[ROLE][rarityFolder] = [filename, ...].
//
// This exists because fs.readdirSync is unreliable against pkg's virtual
// snapshot filesystem. The packaged binary reads this manifest instead of
// listing the directory; plain `node` still uses readdirSync (see cards.js).
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CARDS_DIR = path.join(ROOT, 'assets', 'cards');
const OUT_DIR = path.join(ROOT, 'dist');

// Must match cards.js.
const ROLE_DIR = { LEADER: 'Leader', GUARDIAN: 'Guardian', ASSASSIN: 'Assassin', TRAITOR: 'Traitor' };
const FOLDERS = ['uncommon', 'rare', 'mythic'];

const manifest = {};
let total = 0;
for (const [role, dirName] of Object.entries(ROLE_DIR)) {
  manifest[role] = {};
  for (const folder of FOLDERS) {
    const dir = path.join(CARDS_DIR, dirName, folder);
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.webp'));
    } catch {
      files = [];
    }
    manifest[role][folder] = files;
    total += files.length;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'cards-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`cards-manifest.json written (${total} cards indexed).`);
