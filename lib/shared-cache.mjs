import { createCivicStore, REFRESH_MS } from './civic.mjs';

const LEASE_MS = 45_000;

function cachedPayload(row, now) {
  if (!row?.snapshot) return null;
  const payload = JSON.parse(row.snapshot);
  const snapshotAttempt = Date.parse(payload.attemptedAt ?? payload.refreshedAt ?? '');
  const overdue = now - row.attempt_at >= REFRESH_MS || row.attempt_at > snapshotAttempt;
  if (!overdue) return payload;
  return { ...payload, races: payload.races.map(race => ({ ...race, sourceStale: race.reported || race.status === 'called' })),
    callsStale: payload.callsAvailable !== false,
    chambers: Object.fromEntries(Object.entries(payload.chambers).map(([office, chamber]) =>
      [office, { ...chamber, callsStale: chamber.callsAvailable ?? payload.callsAvailable !== false }])) };
}

export async function getSharedResults(db, { now = Date.now, readJson, log = console.error } = {}) {
  const time = now();
  let row = await db.prepare('SELECT snapshot, attempt_at FROM election_cache WHERE id = 1').first();
  const cached = cachedPayload(row, time);
  if (row && time - row.attempt_at < REFRESH_MS) {
    if (cached) return cached;
    throw new Error('Election data is not available yet');
  }
  if (!row) await db.prepare('INSERT OR IGNORE INTO election_cache (id) VALUES (1)').run();
  const token = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE election_cache SET attempt_at = ?1, lease_until = ?2, lease_token = ?3
    WHERE id = 1 AND attempt_at <= ?4 AND lease_until <= ?1 RETURNING snapshot`)
    .bind(time, time + LEASE_MS, token, time - REFRESH_MS).first();
  if (!claim) {
    if (cached) return cached;
    row = await db.prepare('SELECT snapshot, attempt_at FROM election_cache WHERE id = 1').first();
    const updated = cachedPayload(row, now());
    if (updated) return updated;
    throw new Error('Election refresh is already in progress');
  }
  try {
    const feeds = await db.prepare('SELECT key, value FROM election_feeds').all();
    const state = Object.fromEntries(feeds.results.map(feed => [feed.key, JSON.parse(feed.value)]));
    state.latest = claim.snapshot ? JSON.parse(claim.snapshot) : null;
    const store = createCivicStore({ now, readJson, log, state });
    const snapshot = await store.getSnapshot();
    const updatedState = store.getState();
    const completedAt = now();
    const statements = Object.entries(updatedState).map(([key, value]) => db.prepare(`INSERT INTO election_feeds (key, value)
      SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM election_cache WHERE id = 1 AND lease_token = ?3 AND lease_until > ?4)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .bind(key, JSON.stringify(value), token, completedAt));
    statements.push(db.prepare(`UPDATE election_cache SET snapshot = ?1, lease_until = 0, lease_token = NULL
      WHERE id = 1 AND lease_token = ?2 AND lease_until > ?3`).bind(JSON.stringify(snapshot), token, completedAt));
    const committed = await db.batch(statements);
    if (committed.at(-1).meta.changes !== 1) throw new Error('Election refresh lease expired');
    return snapshot;
  } catch (error) {
    log(JSON.stringify({ event: 'shared_refresh_failed', error: String(error?.stack ?? error), at: new Date(now()).toISOString() }));
    if (!claim.snapshot) {
      await db.prepare('UPDATE election_cache SET lease_until = 0, lease_token = NULL WHERE id = 1 AND lease_token = ?1').bind(token).run();
      throw error;
    }
    const previous = JSON.parse(claim.snapshot);
    const offline = { ...previous, connection: 'offline', callsStale: previous.callsAvailable !== false,
      chambers: Object.fromEntries(Object.entries(previous.chambers).map(([office, chamber]) =>
        [office, { ...chamber, callsStale: chamber.callsAvailable ?? previous.callsAvailable !== false }])),
      attemptedAt: new Date(time).toISOString(), races: previous.races.map(race => ({ ...race, sourceStale: true })) };
    await db.prepare(`UPDATE election_cache SET snapshot = ?1, lease_until = 0, lease_token = NULL
      WHERE id = 1 AND lease_token = ?2`).bind(JSON.stringify(offline), token).run();
    return offline;
  }
}
