import test from 'node:test';
import assert from 'node:assert/strict';
import { createTallyStore } from '../lib/tally.mjs';
import { mergeCachedResults, validPayload } from '../public/results.js';
import { core, emptyResults, emptyLive, countingFlorida, calledFlorida } from './fixtures.mjs';

async function payload({ snapshot = emptyResults, live = emptyLive, failSnapshot = false } = {}) {
  return createTallyStore({ now: () => Date.parse('2026-11-04T01:03:00Z'), log: () => {}, readJson: async path => {
    if (path.endsWith('core.json')) return core;
    if (path.endsWith('results.json')) {
      if (failSnapshot) throw new Error('Test cold-start snapshot outage');
      return snapshot;
    }
    return live;
  } }).getSnapshot();
}

test('A cold-server partial response preserves browser-cached calls and votes until explicit recovery', async () => {
  const previous = await payload({ snapshot: { ...emptyResults, races: { 'S-FL-sp': calledFlorida } } });
  const cold = await payload({ failSnapshot: true });
  assert.equal(validPayload(cold), true);
  assert.equal(cold.callsAvailable, false);
  assert.equal(cold.races[0].reported, false);
  const restored = mergeCachedResults(cold, previous);
  assert.equal(restored.chambers.S.seats.R, 1);
  assert.equal(restored.races[0].votes, 1000);
  assert.equal(restored.races[0].sourceStale, true);
  assert.equal(restored.callsAvailable, true);
  assert.equal(restored.callsStale, true);
  assert.equal(cold.chambers.S.seats.R, 0);

  const partialVotes = await payload({ failSnapshot: true, live: { ...emptyLive, res: { AL: { races: {
    'H-AL-01': { votes: 200, cands: [['Red House', 60, 120], ['Blue House', 40, 80]] },
  } } } } });
  const updated = mergeCachedResults(partialVotes, restored);
  assert.equal(updated.chambers.S.seats.R, 1);
  assert.equal(updated.races.find(race => race.id === 'H-AL-01').votes, 200);

  const correction = await payload({ snapshot: { ...emptyResults, generated_at: '2026-11-04T01:04:00Z', races: { 'S-FL-sp': {
    ...countingFlorida, votes: 0, asof: null,
    cands: [{ name: 'Red Senator', votes: 0 }, { name: 'Blue Senator', votes: 0 }],
  } } } });
  const recovered = mergeCachedResults(correction, updated);
  assert.equal(recovered.chambers.S.seats.R, 0);
  assert.equal(recovered.races[0].votes, 0);
  assert.equal(recovered.races[0].asOf, null);
  assert.equal(recovered.races[0].sourceStale, false);
  assert.equal(recovered.callsStale, false);
});

test('Browser merging keeps newer counts over old cold-server data but accepts authoritative calls', async () => {
  const previous = await payload({ snapshot: { ...emptyResults, races: { 'S-FL-sp': {
    ...countingFlorida, votes: 2000, asof: '2026-11-04T01:02:00Z',
  } } } });
  const older = await payload({ snapshot: { ...emptyResults, races: { 'S-FL-sp': countingFlorida } } });
  const serverRetained = { ...previous, races: previous.races.map(race => ({
    ...race, resultAvailable: false, sourceStale: true,
  })) };
  assert.equal(mergeCachedResults(serverRetained, older).races[0].votes, 2000);
  const retained = mergeCachedResults(older, previous);
  assert.equal(retained.races[0].votes, 2000);
  assert.equal(retained.races[0].sourceStale, true);
  const called = await payload({ failSnapshot: true, live: { ...emptyLive, res: { FL: { races: {
    'S-FL-sp': calledFlorida,
  } } } } });
  const final = mergeCachedResults(called, retained);
  assert.equal(final.chambers.S.seats.R, 1);
  assert.equal(final.races[0].status, 'called');
  assert.equal(final.races[0].sourceStale, false);
  const correctedCall = structuredClone(called);
  Object.assign(correctedCall.races[0], { winnerParty: 'D', winnerName: 'Blue Senator' });
  assert.equal(mergeCachedResults(correctedCall, final).chambers.S.seats.D, 1);
  assert.equal(mergeCachedResults(called, null), called);
});
