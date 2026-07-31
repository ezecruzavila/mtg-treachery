import { randomInt } from 'node:crypto';

/**
 * Game roles. The Leader is public; the rest are secret.
 * @typedef {'LEADER'|'GUARDIAN'|'ASSASSIN'|'TRAITOR'} Role
 */

/**
 * OFFICIAL role distribution for MTG Treachery by player count.
 *
 * This table is the source of truth — it is hardcoded on purpose. The common
 * "Assassins = floor(N/2)" rule does NOT reproduce the 8-player row (it would
 * want 4 Assassins, but the official table is 3 Assassins + 2 Traitors), so
 * trusting the formula would produce an incorrect deal. See the plan.
 *
 * Treachery is defined for 4–8 players.
 */
export const ROLE_TABLE = {
  4: { LEADER: 1, TRAITOR: 1, ASSASSIN: 2, GUARDIAN: 0 },
  5: { LEADER: 1, TRAITOR: 1, ASSASSIN: 2, GUARDIAN: 1 },
  6: { LEADER: 1, TRAITOR: 1, ASSASSIN: 3, GUARDIAN: 1 },
  7: { LEADER: 1, TRAITOR: 1, ASSASSIN: 3, GUARDIAN: 2 },
  8: { LEADER: 1, TRAITOR: 2, ASSASSIN: 3, GUARDIAN: 2 },
};

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;

/** true if `count` players can start a game of Treachery. */
export function canDeal(count) {
  return Number.isInteger(count) && count >= MIN_PLAYERS && count <= MAX_PLAYERS;
}

/**
 * Builds the multiset of roles for N players according to the official table.
 * @param {number} count
 * @returns {Role[]}
 */
export function buildDeck(count) {
  const composition = ROLE_TABLE[count];
  if (!composition) {
    throw new RangeError(`Treachery is for ${MIN_PLAYERS}–${MAX_PLAYERS} players (got ${count}).`);
  }
  const deck = [];
  for (const [role, n] of Object.entries(composition)) {
    for (let i = 0; i < n; i++) deck.push(role);
  }
  return deck;
}

/**
 * Shuffles an array in-place with Fisher–Yates using unbiased cryptographic
 * randomness (`crypto.randomInt`), not `Math.random()`.
 * @template T
 * @param {T[]} arr
 * @returns {T[]} the same array, shuffled
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1); // 0..i inclusive, uniform distribution
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deals roles for a given player count. Returns a fresh array of roles to be
 * assigned by index (does not mutate players; rooms.js does that).
 * @param {number} count number of players
 * @returns {Role[]} shuffled roles, one per player
 */
export function dealRoles(count) {
  if (!canDeal(count)) {
    throw new RangeError(`Treachery is for ${MIN_PLAYERS}–${MAX_PLAYERS} players (got ${count}).`);
  }
  return shuffle(buildDeck(count));
}
