import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { getSharedResults } from '../lib/shared-cache.mjs';
import { core, emptyResults, emptyLive, countingFlorida, calledFlorida, copy } from './fixtures.mjs';

async function database() {
  const sqlite = new DatabaseSync(':memory:');
  const migration = await readFile(new URL('../migrations/0001_election_cache.sql', import.meta.url), 'utf8');
  sqlite.exec(migration);
  const api = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let parameters = [];
      return {
        bind(...values) { parameters = values; return this; },
        async first() { return statement.get(...parameters) ?? null; },
        async all() { return { results: statement.all(...parameters) }; },
        async run() { const outcome = statement.run(...parameters); return { meta: { changes: Number(outcome.changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); },
  };
  return api;
}

function feeds(calls, overrides = {}) {
  return async path => {
    calls.push(path);
    if (overrides.gate) await overrides.gate;
    if (overrides.fail) throw new Error('Test upstream outage');
    return copy(path.endsWith('core.json') ? core : path.endsWith('results.json')
      ? { ...emptyResults, races: { 'S-FL-sp': overrides.race ?? calledFlorida } } : emptyLive);
  };
}

const start = Date.parse('2026-11-04T01:00:00Z');

test('Concurrent cold viewers claim one refresh; persisted state serves new instances for a full minute', async () => {
  const db = await database();
  try {
    let time = start;
    const calls = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const options = { now: () => time, readJson: feeds(calls, { gate }), log: () => {} };
    const viewers = Array.from({ length: 1000 }, () => getSharedResults(db, options));
    const settled = Promise.allSettled(viewers);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 3);
    release();
    const results = await settled;
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const first = results.find(result => result.status === 'fulfilled').value;
    assert.equal(first.chambers.S.seats.R, 1);
    time += 59_999;
    const saved = await getSharedResults(db, { ...options, readJson: feeds(calls) });
    assert.equal(saved.refreshedAt, first.refreshedAt);
    assert.equal(calls.length, 3);
    time++;
    await getSharedResults(db, { ...options, readJson: feeds(calls) });
    assert.equal(calls.length, 5);
    assert.equal(calls.filter(path => path.endsWith('core.json')).length, 1);
  } finally { db.close(); }
});

test('Warm viewers retain results during refresh and shared upstream failure survives another request', async () => {
  const db = await database();
  try {
    let time = start;
    const calls = [];
    const options = { now: () => time, readJson: feeds(calls), log: () => {} };
    const first = await getSharedResults(db, options);
    time += 60_000;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const refreshing = getSharedResults(db, { ...options, readJson: feeds(calls, { gate, fail: true }) });
    await new Promise(resolve => setImmediate(resolve));
    const during = await getSharedResults(db, options);
    assert.equal(during.chambers.S.seats.R, 1);
    assert.equal(during.callsStale, true);
    release();
    const failed = await refreshing;
    assert.equal(failed.connection, 'offline');
    assert.equal(failed.refreshedAt, first.refreshedAt);
    const another = await getSharedResults(db, options);
    assert.equal(another.connection, 'offline');
    assert.equal(another.chambers.S.seats.R, 1);
    assert.equal(calls.length, 5);
    time += 60_000;
    const recovered = await getSharedResults(db, options);
    assert.equal(recovered.connection, 'ok');
    assert.equal(recovered.callsStale, false);
  } finally { db.close(); }
});

test('A database write failure retains and shares the last snapshot without a retry stampede', async () => {
  const db = await database();
  try {
    let time = start;
    const options = { now: () => time, readJson: feeds([]), log: () => {} };
    const first = await getSharedResults(db, options);
    time += 60_000;
    const batch = db.batch;
    db.batch = async () => { throw new Error('Test database write failure'); };
    const failed = await getSharedResults(db, options);
    assert.equal(failed.connection, 'offline');
    db.batch = batch;
    const saved = await getSharedResults(db, options);
    assert.equal(saved.connection, 'offline');
    assert.equal(saved.refreshedAt, first.refreshedAt);
    assert.equal(saved.chambers.S.seats.R, 1);
  } finally { db.close(); }
});

test('An expired updater cannot overwrite a newer owner snapshot or raw feeds', async () => {
  const db = await database();
  try {
    let time = start;
    const options = { now: () => time, readJson: feeds([], { race: countingFlorida }), log: () => {} };
    await getSharedResults(db, options);
    time += 60_000;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const oldUpdater = getSharedResults(db, { ...options, readJson: feeds([], { gate, race: countingFlorida }) });
    await new Promise(resolve => setImmediate(resolve));
    time += 60_000;
    const newerRace = { ...countingFlorida, votes: 2000, asof: '2026-11-04T01:02:00Z' };
    const current = await getSharedResults(db, { ...options, readJson: feeds([], { race: newerRace }) });
    assert.equal(current.races[0].votes, 2000);
    release();
    await oldUpdater;
    const saved = await getSharedResults(db, options);
    assert.equal(saved.races[0].votes, 2000);
    const raw = await db.prepare("SELECT value FROM election_feeds WHERE key = 'results'").first();
    assert.equal(JSON.parse(raw.value).races['S-FL-sp'].votes, 2000);
  } finally { db.close(); }
});
