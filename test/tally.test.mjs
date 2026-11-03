import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCore, normalizeData, createTallyStore, REFRESH_MS } from '../lib/tally.mjs';
import { core, emptyResults, emptyLive, countingFlorida, calledFlorida, copy } from './fixtures.mjs';

test('Congress metadata preserves special elections and ballot verification markers', () => {
  const races = parseCore(core);
  assert.deepEqual(races.map(race => race.id), ['S-FL-sp', 'S-GA', 'H-AL-01', 'H-CA-AL']);
  assert.equal(races[0].special, true);
  assert.equal(races[0].candidates[0].name, 'Red Senator');
  assert.equal(races[0].candidates[0].fecId, 'S-TEST');
  assert.equal(races[1].candidates[0].party, 'R');
  assert.equal(races[3].district, 'AL');
});

test('Leaders, candidate winner flags, and uncredited calls do not award seats', () => {
  const snapshot = { ...emptyResults, races: {
    'S-FL-sp': { ...countingFlorida, leader: 'R', called_by: 'AP', cands: countingFlorida.cands.map(candidate => ({ ...candidate, winner: candidate.party === 'R' })) },
    'S-GA': { status: 'called', leader: 'D', winner_name: 'Blue Georgia', cands: [{ name: 'Blue Georgia', votes: 100, pct: 100, winner: true }] },
  } };
  const result = normalizeData(core, snapshot, emptyLive);
  assert.deepEqual(result.chambers.S, { total: 2, called: 0, seats: { D: 0, R: 0, O: 0 } });
  assert.equal(result.races[0].status, 'counting');
  assert.equal(result.races[1].winnerParty, null);
});

test('Named calls count only this election and survive conflicting live counts', () => {
  const snapshot = { ...emptyResults, races: {
    'S-FL-sp': calledFlorida,
    'H-CA-AL': { status: 'certified', src: 'Test certified results', leader: 'I', winner_name: 'Independent House', cands: [{ name: 'Independent House', party: 'I', votes: 250, pct: 100, winner: true }] },
  } };
  const live = { ...emptyLive, res: { FL: { asOf: '2026-11-04T01:01:00Z', races: {
    'S-FL-sp': { ...countingFlorida, cands: [{ name: 'Blue Senator', party: 'D', pct: 70, votes: 700 }, { name: 'Red Senator', party: 'R', pct: 30, votes: 300 }] },
  } } } };
  const result = normalizeData(core, snapshot, live);
  assert.deepEqual(result.chambers.S.seats, { D: 0, R: 1, O: 0 });
  assert.deepEqual(result.chambers.H.seats, { D: 0, R: 0, O: 1 });
  assert.equal(result.races[0].candidates[0].pct, 51);
  assert.equal(result.races[0].calledBy, 'AP');
});

test('Dry and test records cannot enter live votes or seat counts', async t => {
  const liveRace = { ...calledFlorida, called_by: 'AP' };
  for (const modeAt of ['state-status', 'state-bundle', 'race', 'snapshot', 'snapshot-race']) {
    await t.test(modeAt, () => {
      const live = copy(emptyLive), snapshot = copy(emptyResults);
      live.res.FL = { races: { 'S-FL-sp': copy(liveRace) } };
      if (modeAt === 'state-status') live.st.FL = { mode: 'dry' };
      if (modeAt === 'state-bundle') live.res.FL.mode = 'dry';
      if (modeAt === 'race') live.res.FL.races['S-FL-sp'].mode = 'test';
      if (modeAt.startsWith('snapshot')) {
        live.res = {};
        snapshot.races['S-FL-sp'] = copy(liveRace);
        if (modeAt === 'snapshot') snapshot.mode = 'dry'; else snapshot.races['S-FL-sp'].mode = 'test';
      }
      const result = normalizeData(core, snapshot, live);
      assert.equal(result.races[0].reported, false);
      assert.equal(result.races[0].candidates.every(candidate => candidate.votes === null), true);
      assert.equal(result.chambers.S.called, 0);
    });
  }
});

test('Live compact candidates preserve percentages, infer metadata parties, and reject older counts', () => {
  const live = { ...emptyLive, res: { AL: { src: 'Test AL office', url: 'https://example.invalid/al-results', asOf: '2026-11-04T01:01:00Z', races: {
    'H-AL-01': { votes: 1000, cands: [['Red House', 52.1, 520], { n: 'Blue House', p: 47.9, v: 480 }] },
  } }, FL: { races: { 'S-FL-sp': { ...countingFlorida, asof: '2026-11-04T00:59:00Z', votes: 900 } } } } };
  const result = normalizeData(core, { ...emptyResults, races: { 'S-FL-sp': countingFlorida } }, live);
  const house = result.races.find(race => race.id === 'H-AL-01');
  assert.deepEqual(house.candidates.map(({ party, pct, votes }) => ({ party, pct, votes })), [
    { party: 'R', pct: 52.1, votes: 520 }, { party: 'D', pct: 47.9, votes: 480 },
  ]);
  assert.equal(house.source, 'Test AL office');
  assert.equal(result.races[0].votes, 1000);
});

test('A missing race keeps its last result stale, but an explicit correction replaces it', () => {
  const previous = normalizeData(core, { ...emptyResults, races: { 'S-FL-sp': calledFlorida } }, emptyLive);
  const missing = normalizeData(core, emptyResults, emptyLive, previous);
  assert.equal(missing.races[0].sourceStale, true);
  assert.equal(missing.races[0].candidates[0].votes, 510);
  assert.equal(missing.chambers.S.seats.R, 1);
  const correction = normalizeData(core, { ...emptyResults, races: { 'S-FL-sp': {
    status: 'counting', votes: 0, cands: [{ name: 'Red Senator', votes: 0 }, { name: 'Blue Senator', votes: 0 }],
  } } }, emptyLive, previous);
  assert.equal(correction.chambers.S.called, 0);
  assert.equal(correction.races[0].votes, 0);
  assert.equal(correction.races[0].sourceStale, false);

  const snapshot = { ...emptyResults, races: { 'S-FL-sp': countingFlorida } };
  const live = { ...emptyLive, res: { FL: { races: { 'S-FL-sp': {
    ...countingFlorida, votes: 2000, asof: '2026-11-04T01:02:00Z',
  } } } } };
  const latest = normalizeData(core, snapshot, live);
  const fallback = normalizeData(core, snapshot, emptyLive, latest);
  assert.equal(fallback.races[0].votes, 2000);
  assert.equal(fallback.races[0].asOf, '2026-11-04T01:02:00Z');
  assert.equal(fallback.races[0].sourceStale, true);
  const revised = normalizeData(core, { ...snapshot, races: { 'S-FL-sp': {
    ...countingFlorida, votes: 900, asof: '2026-11-04T01:03:00Z',
  } } }, emptyLive, fallback);
  assert.equal(revised.races[0].votes, 900);
  assert.equal(revised.races[0].sourceStale, false);
});

test('Concurrent viewers share one minute cache, failures keep time and votes, and refresh recovers', async () => {
  let time = Date.parse('2026-11-04T01:00:00Z');
  let fail = false;
  let calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createTallyStore({ now: () => time, log: () => {}, readJson: async path => {
    calls.push(path); await gate;
    if (fail) throw new Error('Test upstream outage');
    return copy(path.endsWith('core.json') ? core : path.endsWith('results.json')
      ? { ...emptyResults, races: { 'S-FL-sp': calledFlorida } } : emptyLive);
  } });
  const first = store.getSnapshot(), concurrent = store.getSnapshot();
  assert.equal(calls.length, 3);
  release();
  const [a, b] = await Promise.all([first, concurrent]);
  assert.equal(a, b);
  time += 59_999;
  await store.getSnapshot();
  assert.equal(calls.length, 3);
  fail = true; time++;
  const failed = await store.getSnapshot();
  assert.equal(calls.length, 5);
  assert.equal(failed.connection, 'offline');
  assert.equal(failed.refreshedAt, a.refreshedAt);
  assert.equal(failed.races[0].candidates[0].votes, 510);
  assert.equal(failed.chambers.S.seats.R, 1);
  fail = false; time += 60_000;
  const recovered = await store.getSnapshot();
  assert.equal(recovered.connection, 'ok');
  assert.notEqual(recovered.refreshedAt, a.refreshedAt);
  assert.equal(calls.filter(path => path.endsWith('core.json')).length, 1);
});

test('Invalid upstream JSON does not replace valid cached results', async () => {
  let time = Date.parse('2026-11-04T01:00:00Z');
  let malformed = false;
  const store = createTallyStore({ now: () => time, log: () => {}, readJson: async path => {
    if (path.endsWith('core.json')) return core;
    if (path === '/api/live') return emptyLive;
    return malformed ? { races: [] } : { ...emptyResults, races: { 'S-FL-sp': calledFlorida } };
  } });
  await store.getSnapshot(); malformed = true; time += REFRESH_MS;
  const next = await store.getSnapshot();
  assert.equal(next.connection, 'partial');
  assert.equal(next.races[0].sourceStale, true);
  assert.equal(next.callsAvailable, true);
  assert.equal(next.callsStale, true);
  assert.equal(next.chambers.S.seats.R, 1);
});

test('Initial snapshot failure leaves called-seat totals unknown even with available live votes', async () => {
  const store = createTallyStore({ log: () => {}, readJson: async path => {
    if (path.endsWith('core.json')) return core;
    if (path.endsWith('results.json')) throw new Error('Test snapshot outage');
    return { ...emptyLive, res: { FL: { races: { 'S-FL-sp': countingFlorida } } } };
  } });
  const result = await store.getSnapshot();
  assert.equal(result.connection, 'partial');
  assert.equal(result.races[0].reported, true);
  assert.equal(result.callsAvailable, false);
  assert.equal(result.callsStale, false);
});
