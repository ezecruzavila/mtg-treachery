import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';

/**
 * Card catalog: indexes the identity card images under assets/cards by role and
 * rarity, and builds the per-role "pool" for a chosen rarity level.
 *
 * Rarity selection is INCREMENTAL (a ceiling):
 *   U -> uncommon only
 *   R -> rare + uncommon
 *   M -> mythic + rare + uncommon
 * The "special" (S) rarity is intentionally excluded for now.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.join(__dirname, '..', 'assets', 'cards');

const ROLES = ['LEADER', 'GUARDIAN', 'ASSASSIN', 'TRAITOR'];
// Folder name on disk per role (capitalized, matches the reorganized structure).
const ROLE_DIR = { LEADER: 'Leader', GUARDIAN: 'Guardian', ASSASSIN: 'Assassin', TRAITOR: 'Traitor' };

// Which rarity folders each incremental level includes.
export const RARITY_LEVELS = {
  U: ['uncommon'],
  R: ['uncommon', 'rare'],
  M: ['uncommon', 'rare', 'mythic'],
};
export const DEFAULT_RARITY = 'U';

/** Public URL path for the shared card back. */
export const CARD_BACK_URL = assetUrl('cards', 'extras', 'card-back.webp');

/**
 * Index built once at startup: index[ROLE][rarityFolder] = [urlPath, ...].
 * @type {Record<string, Record<string, string[]>>}
 */
const index = {};

// Whether card images are bundled into the binary. Injected at build time by
// esbuild (--define:__EMBED_IMAGES__=true|false) to produce two flavors:
//   - remote (default):  images are NOT bundled, served from the official site
//   - embedded:          images are bundled and served locally
// In plain `node` (dev) the define is absent, so we default to false below and
// serve local files anyway (see the isPackaged check).
const EMBED_IMAGES = (typeof __EMBED_IMAGES__ !== 'undefined') ? __EMBED_IMAGES__ : false;
const isPackaged = typeof process.pkg !== 'undefined';
// Fetch remotely only when packaged AND images weren't embedded.
const REMOTE = isPackaged && !EMBED_IMAGES;
const REMOTE_BASE = 'https://www.mtgtreachery.net/images/cards/en/trd';

function assetUrl(...segments) {
  return '/' + ['assets', ...segments].map(encodeURIComponent).join('/');
}

function toUrl(role, rarityFolder, file) {
  if (REMOTE) {
    // Local name: "050 - Leader - (U) - The Blood Empress.webp"
    // Remote name: "050 - Leader - The Blood Empress.jpg" (no rarity tag, .jpg)
    const remoteName = file
      .replace(/ - \([URMS]\) - /, ' - ') // collapse " - (X) - " to a single " - "
      .replace(/\.(png|webp)$/i, '.jpg');
    return `${REMOTE_BASE}/${encodeURIComponent(remoteName)}`;
  }
  return assetUrl('cards', ROLE_DIR[role], rarityFolder, file);
}

// When packaged with pkg, readdirSync on the virtual snapshot fs is unreliable,
// so we read a build-time manifest (dist/cards-manifest.json) instead. In plain
// `node` (dev) there is no manifest and we list the directory as before.
function loadManifest() {
  if (loadManifest.cache !== undefined) return loadManifest.cache;
  if (typeof process.pkg === 'undefined') {
    loadManifest.cache = null;
    return null;
  }
  // Inside the binary the bundle lives in dist/, so __dirname is snapshot dist/.
  try {
    loadManifest.cache = JSON.parse(readFileSync(path.join(__dirname, 'cards-manifest.json'), 'utf8'));
  } catch {
    loadManifest.cache = null;
  }
  return loadManifest.cache;
}

const DEAL_FOLDERS = ['uncommon', 'rare', 'mythic'];
// Gallery order. Special is shown but never dealt.
const CATALOG_FOLDERS = [
  { folder: 'uncommon', rarity: 'U' },
  { folder: 'rare', rarity: 'R' },
  { folder: 'mythic', rarity: 'M' },
  { folder: 'special', rarity: 'S' },
];

function filesIn(role, folder) {
  const manifest = loadManifest();
  if (manifest) return manifest[role]?.[folder] || [];
  const dir = path.join(CARDS_DIR, ROLE_DIR[role], folder);
  try {
    return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.webp'));
  } catch {
    return [];
  }
}

/** "050 - Leader - (U) - The Blood Empress.webp" → name + rarity letter. */
function parseCardFile(file, fallbackRarity) {
  const base = file.replace(/\.(webp|png|jpe?g)$/i, '');
  const m = base.match(/^(\d+)\s+-\s+.+?\s+-\s+\(([URMS])\)\s+-\s+(.+)$/);
  if (!m) return { num: 0, rarity: fallbackRarity, name: base };
  return { num: Number(m[1]), rarity: m[2], name: m[3] };
}

function buildIndex() {
  for (const role of ROLES) {
    index[role] = {};
    for (const folder of DEAL_FOLDERS) {
      const files = filesIn(role, folder).slice().sort();
      index[role][folder] = files.map((f) => toUrl(role, folder, f));
    }
  }
}
buildIndex();

/** Normalizes a rarity value to one of U/R/M, falling back to the default. */
export function normalizeRarity(r) {
  const up = String(r || '').toUpperCase();
  return RARITY_LEVELS[up] ? up : DEFAULT_RARITY;
}

/**
 * Returns the pool of card URLs for a role at a given rarity level (incremental).
 * @param {string} role
 * @param {'U'|'R'|'M'} rarity
 * @returns {string[]}
 */
export function poolFor(role, rarity) {
  const level = normalizeRarity(rarity);
  const folders = RARITY_LEVELS[level];
  const byRole = index[role] || {};
  return folders.flatMap((folder) => byRole[folder] || []);
}

/**
 * Assigns a UNIQUE card URL to each player, honoring their role and the chosen
 * rarity level. `assignments` is an array of role strings (one per player, in
 * order). Returns an array of card URLs aligned by index.
 *
 * Draws without replacement from each role's pool (cards are unique per game).
 * Throws if a role's pool is too small — callers should have validated counts.
 *
 * @param {string[]} roles roles already dealt, one per player
 * @param {'U'|'R'|'M'} rarity
 * @returns {string[]} card URL per player
 */
export function assignCards(roles, rarity) {
  const level = normalizeRarity(rarity);

  // Build a shuffled, drawable pool per role.
  const pools = {};
  for (const role of ROLES) {
    const pool = poolFor(role, level).slice();
    // Fisher–Yates with crypto randomness.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pools[role] = pool;
  }

  return roles.map((role) => {
    const pool = pools[role];
    if (!pool || pool.length === 0) {
      throw new Error(`Not enough ${role} cards for rarity ${level}.`);
    }
    return pool.pop(); // unique: removed from the pool
  });
}

/**
 * Fixed sample table for the home "Example" popup: four non-leader identities
 * plus a Leader, all uncommon. Cards are chosen by their catalog number so the
 * illustration is stable. URLs come from the same index as real cards, so they
 * resolve correctly in every build flavor (local assets or the remote CDN).
 */
const EXAMPLE_CARDS = [
  { role: 'ASSASSIN', num: '046' },
  { role: 'ASSASSIN', num: '047' },
  { role: 'GUARDIAN', num: '006' },
  { role: 'TRAITOR', num: '023' },
];
const EXAMPLE_LEADER = { role: 'LEADER', num: '059' };

/** Finds an uncommon card URL by its catalog number prefix, or null. */
function findCardUrl(role, num) {
  const urls = (index[role] && index[role].uncommon) || [];
  const prefix = String(num) + ' ';
  for (const url of urls) {
    const file = decodeURIComponent(url.split('/').pop() || '');
    if (file.startsWith(prefix)) return url;
  }
  return null;
}

/** The example table payload: the four face-down-able cards plus the Leader. */
export function exampleTable() {
  const map = ({ role, num }) => ({ role, url: findCardUrl(role, num) });
  return {
    cardBack: CARD_BACK_URL,
    cards: EXAMPLE_CARDS.map(map),
    leader: map(EXAMPLE_LEADER),
  };
}

/**
 * Public card gallery: grouped by role, each group ordered by rarity
 * (uncommon → rare → mythic → special) and then by catalog number.
 */
export function cardCatalog() {
  const groups = [];
  for (const role of ROLES) {
    const cards = [];
    for (const { folder, rarity } of CATALOG_FOLDERS) {
      const files = filesIn(role, folder).slice().sort((a, b) => {
        const pa = parseCardFile(a, rarity);
        const pb = parseCardFile(b, rarity);
        return pa.num - pb.num || a.localeCompare(b);
      });
      for (const file of files) {
        const meta = parseCardFile(file, rarity);
        cards.push({ name: meta.name, rarity: meta.rarity, url: toUrl(role, folder, file) });
      }
    }
    if (cards.length) groups.push({ role, cards });
  }
  return { groups };
}

/** For diagnostics/tests: pool sizes per role at each level. */
export function poolSizes() {
  const out = {};
  for (const role of ROLES) {
    out[role] = {
      U: poolFor(role, 'U').length,
      R: poolFor(role, 'R').length,
      M: poolFor(role, 'M').length,
    };
  }
  return out;
}
