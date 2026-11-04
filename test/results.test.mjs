import test from 'node:test';
import assert from 'node:assert/strict';
import { createCivicStore } from '../lib/civic.mjs';
import { mergeCachedResults, validPayload } from '../public/results.js';
import { civicFeed, countingFlorida, calledFlorida } from './fixtures.mjs';

async function payload({ senate = civicFeed('S'), house = civicFeed('H'), failSenate = false } = {}) {
  return createCivicStore({ now: () => Date.parse('2026-11-04T01:03:00Z'), log: () => {}, readJson: async path => {
    if (path.endsWith('87528')) {
      if (failSenate) throw new Error('Test cold-start Senate outage');
      return senate;
    }
    return house;
  } }).getSnapshot();
}

test('A cold-server partial response restores only the missing chamber from OBS until recovery', async () => {
  const previous = await payload({ senate: civicFeed('S', { fl: calledFlorida }) });
  const cold = await payload({ failSenate: true });
  assert.equal(validPayload(cold), true);
  assert.equal(cold.chambers.S.callsAvailable, false);
  const restored = mergeCachedResults(cold, previous);
  assert.equal(restored.chambers.S.seats.R, 1);
  assert.equal(restored.races.find(race => race.id === 'S-FL-sp').votes, 1000);
  assert.equal(restored.chambers.S.callsStale, true);
  assert.equal(restored.chambers.H.callsStale, false);
  assert.equal(restored.callsAvailable, true);
  assert.equal(restored.callsStale, true);
  assert.equal(cold.chambers.S.seats.R, 0);

  const correction = await payload({ senate: civicFeed('S', {}, '2026-11-04T01:04:00Z') });
  const recovered = mergeCachedResults(correction, restored);
  assert.equal(recovered.chambers.S.seats.R, 0);
  assert.equal(recovered.races[0].votes, 0);
  assert.equal(recovered.races[0].sourceStale, false);
  assert.equal(recovered.callsStale, false);
});

test('Browser merging keeps newer counts, accepts fresh calls, and applies call corrections', async () => {
  const double = { ...countingFlorida, candidates: countingFlorida.candidates.map(candidate => ({ ...candidate, votes: candidate.votes * 2 })) };
  const previous = await payload({ senate: civicFeed('S', { fl: double }, '2026-11-04T01:02:00Z') });
  const older = await payload({ senate: civicFeed('S', { fl: countingFlorida }) });
  const retained = mergeCachedResults(older, previous);
  assert.equal(retained.races[0].votes, 2000);
  assert.equal(retained.races[0].sourceStale, true);
  const called = await payload({ senate: civicFeed('S', { fl: calledFlorida }, '2026-11-04T01:03:00Z') });
  const final = mergeCachedResults(called, retained);
  assert.equal(final.chambers.S.seats.R, 1);
  assert.equal(final.races[0].sourceStale, false);
  const correctedCall = structuredClone(called);
  Object.assign(correctedCall.races[0], { winnerParty: 'D', winnerName: 'Blue Senator' });
  assert.equal(mergeCachedResults(correctedCall, final).chambers.S.seats.D, 1);
  assert.equal(mergeCachedResults(called, null), called);
});
