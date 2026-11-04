import { STATE_NAMES } from '../public/view-model.js';

export const REFRESH_MS = 60_000;
const ROOT = 'https://civicapi.org';
const FEEDS = {
  S: { path: '/api/v2/race/87528', type: 'US Senate', total: 35 },
  H: { path: '/api/v2/race/87524', type: 'House of Representatives', total: 435 },
};

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function party(value) {
  if (value === 'Democratic') return 'D';
  if (value === 'Republican') return 'R';
  return 'O';
}

function raceMetadata(key, office) {
  const code = key.toUpperCase();
  const state = code.slice(0, 2);
  const valid = office === 'S' ? /^[A-Z]{2}$/.test(code) : /^[A-Z]{2}-(?:\d{2}|AL)$/.test(code);
  if (!valid || !STATE_NAMES[state]) throw new Error(`Invalid civicAPI ${office} region: ${key}`);
  // These two 2026 Senate contests fill unexpired terms; the API keys them by state.
  const special = office === 'S' && ['FL', 'OH'].includes(state);
  const raceCode = special ? `${state}-sp` : code;
  return { id: `${office}-${raceCode}`, office, code: raceCode, state,
    district: office === 'H' ? code.slice(3) : null, special, rating: 3 };
}

function validate(office, value) {
  const spec = FEEDS[office];
  if (!object(value) || value.test_data !== false || value.country !== 'US' ||
    value.election_scope !== 'General' || value.election_type !== spec.type ||
    !/^2026-11-03T/.test(value.election_date ?? '') || !Number.isFinite(Date.parse(value.last_updated)) ||
    !object(value.region_results) || Object.keys(value.region_results).length !== spec.total) {
    throw new Error(`Invalid civicAPI ${office} election response`);
  }
  const ids = new Set();
  for (const [key, region] of Object.entries(value.region_results)) {
    const meta = raceMetadata(key, office);
    if (ids.has(meta.id)) throw new Error(`Invalid civicAPI duplicate region: ${key}`);
    ids.add(meta.id);
    if (!object(region) || region.test_data === true || !Number.isInteger(region.election_id) ||
      !Array.isArray(region.candidates) || !region.candidates.length ||
      region.candidates.filter(candidate => candidate.winner === true).length > 1) {
      throw new Error(`Invalid civicAPI region: ${key}`);
    }
    for (const candidate of region.candidates) {
      if (!object(candidate) || typeof candidate.name !== 'string' || !candidate.name.trim() ||
        typeof candidate.party !== 'string' || typeof candidate.winner !== 'boolean' ||
        !Number.isSafeInteger(candidate.votes) || candidate.votes < 0 ||
        !Number.isFinite(candidate.percent) || candidate.percent < 0 || candidate.percent > 100) {
        throw new Error(`Invalid civicAPI candidate in ${key}`);
      }
    }
  }
  return value;
}

export function normalizeData(feeds, previous = null, failed = {}) {
  const oldRaces = new Map((previous?.races ?? []).map(race => [race.id, race]));
  const races = [];
  const chambers = {};
  for (const office of ['S', 'H']) {
    const feed = feeds[office];
    const oldContests = (previous?.races ?? []).filter(race => race.office === office);
    const contests = feed ? Object.entries(feed.region_results).map(([key, region]) => {
      const meta = raceMetadata(key, office);
      const candidates = region.candidates.map(candidate => ({
        name: candidate.name.trim(), party: party(candidate.party), votes: candidate.votes,
        pct: candidate.percent, winner: candidate.winner, incumbent: candidate.incumbent === true,
      }));
      const old = oldRaces.get(meta.id);
      if (old && Date.parse(feed.last_updated) < Date.parse(old.asOf ?? '')) {
        return { ...old, sourceStale: true, resultAvailable: false };
      }
      const winner = candidates.find(candidate => candidate.winner);
      const votes = candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
      const reported = votes > 0;
      return { ...meta, candidates, votes, reported, resultAvailable: true,
        status: winner ? 'called' : reported ? 'counting' : 'waiting',
        winnerParty: winner?.party ?? null, winnerName: winner?.name ?? null,
        calledBy: winner ? 'civicAPI' : null,
        // Aggregates expose a chamber update time, but no individual call timestamps.
        asOf: feed.last_updated, calledAt: null,
        source: 'civicAPI', sourceUrl: `${ROOT}/api/v2/race/${region.election_id}`,
        sourceStale: Boolean(failed[office]), feedError: Boolean(failed[office]),
      };
    }) : oldContests.map(race => ({ ...race, sourceStale: true, resultAvailable: false, feedError: true }));
    const seats = { D: 0, R: 0, O: 0 };
    // National Senate seat totals include holdovers. Only individual winners belong here.
    for (const race of contests) if (race.status === 'called') seats[race.winnerParty]++;
    const callsAvailable = Boolean(feed) || (oldContests.length > 0 &&
      (previous.chambers[office].callsAvailable ?? previous.callsAvailable !== false));
    chambers[office] = { total: FEEDS[office].total, called: seats.D + seats.R + seats.O, seats,
      callsAvailable, callsStale: Boolean(failed[office] && callsAvailable) || contests.some(race => race.sourceStale) };
    races.push(...contests);
  }
  return { races, chambers };
}

async function fetchJson(path) {
  const response = await fetch(ROOT + path, {
    signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

export function createCivicStore({ readJson = fetchJson, now = Date.now, log = console.error, state = {} } = {}) {
  const feeds = { S: state.civicSenate ?? null, H: state.civicHouse ?? null };
  let latest = state.latest ?? null;
  let attemptAt = -Infinity;
  let pending = null;

  async function refresh() {
    attemptAt = now();
    const offices = ['S', 'H'];
    const fetched = await Promise.allSettled(offices.map(async office => validate(office, await readJson(FEEDS[office].path))));
    const failed = {};
    let successes = 0;
    fetched.forEach((outcome, index) => {
      const office = offices[index];
      if (outcome.status === 'rejected') {
        failed[office] = true;
        log(JSON.stringify({ event: 'civic_fetch_failed', path: FEEDS[office].path,
          error: String(outcome.reason?.stack ?? outcome.reason), at: new Date(now()).toISOString() }));
      } else { feeds[office] = outcome.value; successes++; }
    });
    if (!feeds.S && !feeds.H && !latest) throw new Error('Election data is not available yet');
    const data = normalizeData(feeds, latest, failed);
    latest = { ...data, schemaVersion: 1, connection: successes === 0 ? 'offline' : successes === 2 ? 'ok' : 'partial',
      callsAvailable: offices.every(office => data.chambers[office].callsAvailable),
      callsStale: offices.some(office => data.chambers[office].callsStale),
      refreshedAt: successes ? new Date(now()).toISOString() : latest?.refreshedAt ?? null,
      attemptedAt: new Date(attemptAt).toISOString(), pollIntervalMs: REFRESH_MS,
      source: !feeds.S && !feeds.H && latest?.source ? latest.source
        : { name: 'civicAPI', url: ROOT, license: 'Free use with attribution' },
      feedStatus: Object.fromEntries(offices.map(office => [office, {
        feed: feeds[office] && !failed[office] ? 'ok' : 'error', mode: null,
        source: `civicAPI ${office === 'S' ? 'Senate' : 'House'}`, url: ROOT + FEEDS[office].path,
        error: Boolean(failed[office]), checkedAt: new Date(attemptAt).toISOString(),
      }])),
    };
    return latest;
  }

  return {
    getState() { return { civicSenate: feeds.S, civicHouse: feeds.H }; },
    async getSnapshot() {
      if (pending) return pending;
      if (latest && now() - attemptAt < REFRESH_MS) return latest;
      pending = refresh();
      try { return await pending; } finally { pending = null; }
    },
  };
}
