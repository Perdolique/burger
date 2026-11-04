import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeData, createCivicStore, REFRESH_MS } from '../lib/civic.mjs';
import { civicFeed, countingFlorida, calledFlorida } from './fixtures.mjs';

function reader(senate = civicFeed('S'), house = civicFeed('H')) {
  return async path => path.endsWith('87528') ? senate : house;
}

test('Individual 2026 winners count seats, excluding national holdovers and uncalled leaders', async () => {
  const houseWinner = { ...countingFlorida, candidates: [{ name: 'Independent House', party: 'Independent', votes: 250, percent: 100, winner: true }] };
  const result = await createCivicStore({ readJson: reader(civicFeed('S', { fl: calledFlorida, ga: countingFlorida }), civicFeed('H', { 'ak-al': houseWinner })) }).getSnapshot();
  assert.equal(result.races.length, 470);
  assert.deepEqual(result.chambers.S, { total: 35, called: 1, seats: { D: 0, R: 1, O: 0 }, callsAvailable: true, callsStale: false });
  assert.deepEqual(result.chambers.H.seats, { D: 0, R: 0, O: 1 });
  assert.equal(result.chambers.H.total, 435);
  assert.equal(result.races.find(race => race.id === 'S-OH-sp').special, true);
  assert.equal(result.races.find(race => race.id === 'S-FL-sp').calledBy, 'civicAPI');
  assert.equal(result.races.find(race => race.id === 'S-GA').status, 'counting');
  assert.equal(result.races.find(race => race.id === 'H-AK-AL').district, 'AL');
  assert.equal(result.races[0].calledAt, null);
  assert.equal(result.source.name, 'civicAPI');
});

test('Concurrent viewers share a minute cache, outages preserve time and votes, and refresh recovers', async () => {
  let time = Date.parse('2026-11-04T01:00:00Z');
  let fail = false;
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createCivicStore({ now: () => time, log: () => {}, readJson: async path => {
    calls.push(path); await gate;
    if (fail) throw new Error('Test upstream outage');
    return reader(civicFeed('S', { fl: calledFlorida }))(path);
  } });
  const first = store.getSnapshot(), concurrent = store.getSnapshot();
  assert.equal(calls.length, 2);
  release();
  const [a, b] = await Promise.all([first, concurrent]);
  assert.equal(a, b);
  time += REFRESH_MS - 1;
  await store.getSnapshot();
  assert.equal(calls.length, 2);
  fail = true; time++;
  const failed = await store.getSnapshot();
  assert.equal(calls.length, 4);
  assert.equal(failed.connection, 'offline');
  assert.equal(failed.refreshedAt, a.refreshedAt);
  assert.equal(failed.races[0].votes, 1000);
  assert.equal(failed.chambers.S.seats.R, 1);
  fail = false; time += REFRESH_MS;
  const recovered = await store.getSnapshot();
  assert.equal(recovered.connection, 'ok');
  assert.equal(recovered.callsStale, false);
  assert.notEqual(recovered.refreshedAt, a.refreshedAt);
});

test('Malformed, incomplete, wrong-election and test feeds cannot erase valid saved calls', async t => {
  const mutations = {
    'test election': feed => { feed.test_data = true; },
    'test region': feed => { feed.region_results.fl.test_data = true; },
    'wrong date': feed => { feed.election_date = '2024-11-05T05:00:00Z'; },
    'wrong office': feed => { feed.election_type = 'Governor'; },
    'primary': feed => { feed.election_scope = 'Primary'; },
    'missing race': feed => { delete feed.region_results.fl; },
    'invalid votes': feed => { feed.region_results.fl.candidates[0].votes = -1; },
    'invalid percentage': feed => { feed.region_results.fl.candidates[0].percent = null; },
    'missing winner flag': feed => { delete feed.region_results.fl.candidates[0].winner; },
    'multiple winners': feed => { feed.region_results.fl.candidates.forEach(candidate => { candidate.winner = true; }); },
    'duplicate region': feed => { feed.region_results.FL = feed.region_results.fl; delete feed.region_results.ga; },
    'unknown state': feed => { feed.region_results.zz = feed.region_results.fl; delete feed.region_results.fl; },
    'ineligible Senate state': feed => { feed.region_results.az = feed.region_results.fl; delete feed.region_results.fl; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    let time = Date.parse('2026-11-04T01:00:00Z');
    let senate = civicFeed('S', { fl: calledFlorida });
    const logs = [];
    const store = createCivicStore({ now: () => time, log: line => logs.push(JSON.parse(line)), readJson: async path => reader(senate)(path) });
    await store.getSnapshot();
    senate = civicFeed('S'); mutate(senate); time += REFRESH_MS;
    const next = await store.getSnapshot();
    assert.equal(next.connection, 'partial');
    assert.equal(next.races[0].sourceStale, true);
    assert.equal(next.chambers.S.seats.R, 1);
    assert.equal(next.chambers.S.callsStale, true);
    assert.equal(next.chambers.H.callsStale, false);
    assert.match(logs[0].error, /Invalid civicAPI/);
    assert.equal(logs[0].path, '/api/v2/race/87528');
  });
});

test('Invalid House district substitutions preserve the complete saved chamber', async t => {
  for (const [valid, invalid] of [['ca-52', 'ca-99'], ['ak-al', 'ak-01']]) await t.test(invalid, async () => {
    let time = Date.parse('2026-11-04T01:00:00Z');
    let house = civicFeed('H', { [valid]: calledFlorida });
    const store = createCivicStore({ now: () => time, log: () => {}, readJson: async path => reader(civicFeed('S'), house)(path) });
    await store.getSnapshot();
    house = structuredClone(house);
    house.region_results[invalid] = house.region_results[valid];
    delete house.region_results[valid];
    time += REFRESH_MS;
    const next = await store.getSnapshot();
    assert.equal(next.connection, 'partial');
    assert.equal(next.chambers.H.seats.R, 1);
    assert.equal(next.chambers.H.callsStale, true);
    assert.equal(next.chambers.S.callsStale, false);
    assert.equal(next.races.filter(race => race.office === 'H').length, 435);
    assert.equal(next.races.some(race => race.id === `H-${valid.toUpperCase()}`), true);
    assert.equal(next.races.some(race => race.id === `H-${invalid.toUpperCase()}`), false);
  });
});

test('Older source updates stay stale, but newer corrections can retract calls or reduce votes', async () => {
  const previous = normalizeData({ S: civicFeed('S', { fl: calledFlorida }, '2026-11-04T01:02:00Z'), H: civicFeed('H') });
  const older = normalizeData({ S: civicFeed('S', { fl: countingFlorida }), H: civicFeed('H') }, previous);
  assert.equal(older.chambers.S.seats.R, 1);
  assert.equal(older.races[0].sourceStale, true);
  const corrected = normalizeData({ S: civicFeed('S', {}, '2026-11-04T01:03:00Z'), H: civicFeed('H') }, older);
  assert.equal(corrected.chambers.S.seats.R, 0);
  assert.equal(corrected.races[0].votes, 0);
  assert.equal(corrected.races[0].sourceStale, false);
});

test('Cold partial data leaves only the failed chamber unknown and recovers on the next refresh', async () => {
  let time = Date.parse('2026-11-04T01:00:00Z');
  let fail = true;
  const store = createCivicStore({ now: () => time, log: () => {}, readJson: async path => {
    if (fail && path.endsWith('87528')) throw new Error('Test Senate outage');
    return reader(civicFeed('S', { fl: calledFlorida }))(path);
  } });
  const cold = await store.getSnapshot();
  assert.equal(cold.connection, 'partial');
  assert.equal(cold.chambers.S.callsAvailable, false);
  assert.equal(cold.chambers.H.callsAvailable, true);
  assert.equal(cold.chambers.S.total, 35);
  fail = false; time += REFRESH_MS;
  assert.equal((await store.getSnapshot()).chambers.S.seats.R, 1);
});

test('Old provider snapshots remain available on migration outages; new feeds replace them after recovery', async () => {
  const old = { ...normalizeData({ S: civicFeed('S', { fl: calledFlorida }), H: civicFeed('H') }), callsAvailable: true,
    refreshedAt: '2026-11-04T01:00:00Z', source: { name: "The People's Tally" } };
  for (const chamber of Object.values(old.chambers)) { delete chamber.callsAvailable; delete chamber.callsStale; }
  for (const race of old.races) race.source = "The People's Tally";
  const store = createCivicStore({ log: () => {}, state: { latest: old, results: { ignored: true } }, readJson: async () => { throw new Error('Test outage'); } });
  const failed = await store.getSnapshot();
  assert.equal(failed.connection, 'offline');
  assert.equal(failed.chambers.S.seats.R, 1);
  assert.equal(failed.source.name, "The People's Tally");
  assert.equal(failed.races[0].source, "The People's Tally");
  const state = store.getState();
  assert.deepEqual(state, { civicSenate: null, civicHouse: null });
  const recovered = await createCivicStore({ state: { ...state, latest: failed }, readJson: reader() }).getSnapshot();
  assert.equal(recovered.chambers.S.seats.R, 0);
  assert.equal(recovered.connection, 'ok');
});

test('A cold outage returns no fabricated data and waits a full minute before retrying', async () => {
  let time = Date.parse('2026-11-04T01:00:00Z');
  let calls = 0;
  let fail = true;
  const store = createCivicStore({ now: () => time, log: () => {}, readJson: async path => {
    calls++;
    if (fail) throw new Error('Test outage');
    return reader()(path);
  } });
  await assert.rejects(store.getSnapshot(), /not available yet/);
  await assert.rejects(store.getSnapshot(), /not available yet/);
  assert.equal(calls, 2);
  fail = false;
  time += REFRESH_MS - 1;
  await assert.rejects(store.getSnapshot(), /not available yet/);
  assert.equal(calls, 2);
  time++;
  assert.equal((await store.getSnapshot()).connection, 'ok');
  assert.equal(calls, 4);
});
