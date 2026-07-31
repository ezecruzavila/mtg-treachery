import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_TABLE, dealRoles, canDeal, MIN_PLAYERS, MAX_PLAYERS } from './deal.js';

/** Counts occurrences of each role in an array. */
function tally(roles) {
  const t = { LEADER: 0, GUARDIAN: 0, ASSASSIN: 0, TRAITOR: 0 };
  for (const r of roles) t[r]++;
  return t;
}

test('each N from 4 to 8 deals exactly the official composition', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const roles = dealRoles(n);
    assert.equal(roles.length, n, `should deal ${n} roles`);
    assert.deepEqual(tally(roles), { LEADER: 0, GUARDIAN: 0, ASSASSIN: 0, TRAITOR: 0, ...ROLE_TABLE[n] },
      `the composition for ${n} players must match the official table`);
  }
});

test('the official table is as expected (exactly 1 Leader and >=1 Traitor)', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const c = ROLE_TABLE[n];
    assert.equal(c.LEADER, 1, `${n}: exactly 1 Leader`);
    assert.ok(c.TRAITOR >= 1, `${n}: at least 1 Traitor`);
    const total = c.LEADER + c.GUARDIAN + c.ASSASSIN + c.TRAITOR;
    assert.equal(total, n, `${n}: role sum must equal player count`);
  }
});

test('8 players = 1 Leader, 2 Traitors, 3 Assassins, 2 Guardians (NOT 4 Assassins)', () => {
  // This is the case where the floor(N/2) formula would be wrong.
  assert.deepEqual(ROLE_TABLE[8], { LEADER: 1, TRAITOR: 2, ASSASSIN: 3, GUARDIAN: 2 });
  assert.notEqual(ROLE_TABLE[8].ASSASSIN, Math.floor(8 / 2));
});

test('rejects counts outside 4–8', () => {
  for (const n of [0, 1, 2, 3, 9, 10, 3.5, NaN]) {
    assert.equal(canDeal(n), false, `${n} must not be dealable`);
    assert.throws(() => dealRoles(n), RangeError);
  }
});

test('the deal is varied across many runs (randomness)', () => {
  // With 5 players there are several possible Leader positions; check the
  // Leader does not always land in the same spot.
  const leaderPositions = new Set();
  for (let i = 0; i < 200; i++) {
    const roles = dealRoles(5);
    leaderPositions.add(roles.indexOf('LEADER'));
  }
  assert.ok(leaderPositions.size >= 3,
    `the Leader should appear in several positions, saw ${leaderPositions.size}`);
});
