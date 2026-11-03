export const REFRESH_MS = 60_000;
const METADATA_MS = 15 * 60_000;
const ROOT = 'https://thepeoplestally.com';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function party(value) {
  const key = String(value ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (['D', 'DEM', 'DEMOCRAT', 'DEMOCRATIC', 'DFL', 'DEMOCRATICFARMERLABOR'].includes(key)) return 'D';
  if (['R', 'REP', 'GOP', 'REPUBLICAN'].includes(key)) return 'R';
  return 'O';
}

function nameKey(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/,?\s+(Jr|Sr|II|III|IV)\.?$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function surname(value) {
  return nameKey(String(value).replace(/,?\s+(Jr|Sr|II|III|IV)\.?$/i, '').trim().split(/\s+/).at(-1));
}

export function parseCore(core) {
  if (!object(core) || typeof core.races !== 'string') throw new Error('Invalid core metadata');
  const races = core.races.split('\n').flatMap(line => {
    const [office, code, incumbent, incumbentParty, rating, ballot = ''] = line.split('|');
    if (!['S', 'H'].includes(office) || !/^[A-Z]{2}(?:-(?:\d{2}|AL|sp))?$/.test(code ?? '')) return [];
    const candidates = ballot.split(';').flatMap(entry => {
      const separator = entry.indexOf(':');
      if (separator < 1) return [];
      const rawParty = entry.slice(0, separator);
      const [label, detail = ''] = entry.slice(separator + 1).split('#');
      const name = label.replace(/\s*\*\s*$/, '').trim();
      if (!name) return [];
      return [{ name, party: party(rawParty[0]), incumbent: /\*\s*$/.test(label), fecId: detail.split('~')[0] || null }];
    });
    return [{ id: `${office}-${code}`, office, code, state: code.slice(0, 2),
      district: office === 'H' ? code.slice(3) : null,
      special: office === 'S' && code.endsWith('-sp'),
      rating: number(rating) ?? 3, candidates,
      officialUrl: core.sites?.[code.slice(0, 2)] ?? null }];
  });
  if (!races.some(race => race.office === 'S') || !races.some(race => race.office === 'H')) {
    throw new Error('Core metadata has no congressional contests');
  }
  return races;
}

function isDry(...records) {
  return records.some(record => record && (
    /^(dry|test|demo|simulation)$/i.test(String(record.mode ?? record.status ?? '')) ||
    record.test === true || record.is_test === true
  ));
}

function candidateRecord(raw, metadata) {
  const item = Array.isArray(raw)
    ? { name: raw[0], pct: raw[1], votes: raw[2], party: raw[3] }
    : raw;
  if (!object(item)) return null;
  const name = String(item.name ?? item.n ?? '').trim();
  if (!name) return null;
  const exact = metadata.find(candidate => nameKey(candidate.name) === nameKey(name));
  const lastMatches = metadata.filter(candidate => surname(candidate.name) === surname(name));
  const match = exact ?? (lastMatches.length === 1 ? lastMatches[0] : null);
  const pct = number(item.pct ?? item.p);
  return { name, party: item.party ? party(item.party) : match?.party ?? 'O',
    votes: number(item.votes ?? item.v), pct: pct === null ? null : Math.min(100, pct),
    winner: item.winner === true, incumbent: match?.incumbent ?? false };
}

function normalizeRace(meta, raw, feed, sourceStale) {
  const resultCandidates = Array.isArray(raw?.cands)
    ? raw.cands.map(candidate => candidateRecord(candidate, meta.candidates)).filter(Boolean) : [];
  const candidates = resultCandidates.length ? resultCandidates : meta.candidates.map(candidate => ({
    name: candidate.name, party: candidate.party, votes: null, pct: null, winner: false,
    incumbent: candidate.incumbent,
  }));
  const votesSum = resultCandidates.reduce((sum, candidate) => sum + (candidate.votes ?? 0), 0);
  const total = number(raw?.votes) ?? votesSum;
  for (const candidate of candidates) {
    if (candidate.pct === null && total > 0 && candidate.votes !== null) {
      candidate.pct = Math.min(100, candidate.votes / total * 100);
    }
  }
  const reported = total > 0 || candidates.some(candidate => (candidate.pct ?? 0) > 0);
  const callSource = String(raw?.called_by ?? (raw?.status === 'certified' ? raw?.src ?? '' : '')).trim();
  const flaggedWinners = candidates.filter(candidate => candidate.winner);
  const namedWinner = candidates.find(candidate => nameKey(candidate.name) === nameKey(raw?.winner_name));
  const winner = namedWinner ?? (flaggedWinners.length === 1 ? flaggedWinners[0] : null);
  const leaderIsKnown = typeof raw?.leader === 'string' && raw.leader.trim() !== '';
  const winnerParty = winner?.party ?? (leaderIsKnown ? party(raw.leader) : null);
  const called = ['called', 'certified'].includes(raw?.status) && callSource !== '' && winnerParty !== null;
  return { ...meta, candidates: candidates.map(candidate => ({ ...candidate,
    winner: called && winner ? candidate.name === winner.name : false })),
    votes: total, reported, resultAvailable: Boolean(raw), status: called ? 'called' : reported ? 'counting' : 'waiting',
    winnerParty: called ? winnerParty : null,
    winnerName: called ? winner?.name ?? String(raw?.winner_name ?? '') : null,
    calledBy: called ? callSource : null,
    asOf: raw?.asof ?? raw?.asOf ?? null,
    calledAt: called ? raw?.called_at ?? raw?.asof ?? null : null,
    source: raw?.src ?? feed?.src ?? null,
    sourceUrl: raw?.url ?? feed?.url ?? meta.officialUrl,
    sourceStale, feedError: Boolean(feed?.err),
  };
}

function getLiveRace(live, meta) {
  const state = live?.res?.[meta.state];
  const raw = state?.races?.[meta.id];
  if (!object(raw) || isDry(live, state, live?.st?.[meta.state], raw)) return null;
  return { ...raw, status: raw.status ?? 'counting',
    asof: raw.asof ?? state.asOf ?? null,
    src: raw.src ?? state.src, url: raw.url ?? state.url };
}

export function normalizeData(core, snapshot, live, previous = null, failed = {}) {
  const metadata = parseCore(core);
  const oldRaces = new Map((previous?.races ?? []).map(race => [race.id, race]));
  const races = metadata.map(meta => {
    let saved = snapshot?.races?.[meta.id];
    if (!object(saved) || isDry(snapshot, snapshot?.states?.[meta.state], saved)) saved = null;
    const feed = live?.st?.[meta.state];
    const fromLive = getLiveRace(live, meta);
    const savedNormalized = saved ? normalizeRace(meta, saved, feed, Boolean(failed.results)) : null;
    let raw = saved;
    let sourceStale = Boolean(failed.results);
    if (fromLive && savedNormalized?.status !== 'called') {
      const savedTime = Date.parse(saved?.asof ?? snapshot?.generated_at ?? '') || 0;
      const liveTime = Date.parse(fromLive.asof ?? live?.at ?? '') || 0;
      if (!saved || liveTime >= savedTime) { raw = fromLive; sourceStale = Boolean(failed.live); }
    }
    const old = oldRaces.get(meta.id);
    const current = normalizeRace(meta, raw, feed, raw ? sourceStale : false);
    const currentTime = Date.parse(current.asOf ?? (raw === saved ? snapshot?.generated_at : live?.at) ?? '');
    const olderCount = current.status !== 'called' &&
      currentTime < Date.parse(old?.asOf ?? '');
    if (old && (old.reported || old.status === 'called') && (!raw || olderCount)) {
      return { ...old, ...meta, candidates: old.candidates,
        resultAvailable: false, sourceStale: true, feedError: Boolean(feed?.err) };
    }
    return current;
  });
  const chambers = Object.fromEntries(['S', 'H'].map(office => {
    const contests = races.filter(race => race.office === office);
    const seats = { D: 0, R: 0, O: 0 };
    for (const race of contests) if (race.status === 'called') seats[race.winnerParty]++;
    return [office, { total: contests.length, called: seats.D + seats.R + seats.O, seats }];
  }));
  return { races, chambers };
}


function compactFeed(path, value) {
  if (!object(value)) return value;
  const congress = races => object(races)
    ? Object.fromEntries(Object.entries(races).filter(([id]) => /^[SH]-[A-Z]{2}(?:-|$)/.test(id))) : races;
  if (path.endsWith('core.json')) return { sites: value.sites, races: typeof value.races === 'string'
    ? value.races.split('\n').filter(line => /^[SH]\|/.test(line)).map(line => line.replace(/~[^;|\n]*/g, '')).join('\n') : value.races };
  if (path.endsWith('results.json')) {
    const { counties, measures, updates, ...snapshot } = value;
    return { ...snapshot, races: congress(value.races) };
  }
  const { ev, ...live } = value;
  return { ...live, res: object(value.res) ? Object.fromEntries(Object.entries(value.res).map(([state, bundle]) =>
    [state, object(bundle) ? { ...bundle, races: congress(bundle.races) } : bundle])) : value.res };
}

async function fetchJson(path) {
  const response = await fetch(ROOT + path, {
    signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return compactFeed(path, await response.json());
}

function validate(kind, value) {
  if (kind === 'core') { parseCore(value); return value; }
  if (!object(value) || (kind === 'results' && !object(value.races)) ||
    (kind === 'live' && (!object(value.res) || !object(value.st)))) {
    throw new Error(`Invalid ${kind} response`);
  }
  return value;
}

export function createTallyStore({ readJson = fetchJson, now = Date.now, log = console.error, state = {} } = {}) {
  let core = state.core ?? null;
  let coreAt = state.coreAt ?? -Infinity;
  let results = state.results ?? null;
  let live = state.live ?? null;
  let latest = state.latest ?? null;
  let attemptAt = -Infinity;
  let pending = null;
  const feedErrors = new Map();

  async function refresh() {
    attemptAt = now();
    const tasks = [
      ['results', '/data/results.json'], ['live', '/api/live'],
      ...(!core || now() - coreAt >= METADATA_MS ? [['core', '/data/core.json']] : []),
    ];
    const fetched = await Promise.allSettled(tasks.map(async ([kind, path]) => validate(kind, await readJson(path))));
    const errors = {};
    let resultSuccesses = 0;
    fetched.forEach((outcome, index) => {
      const [kind, path] = tasks[index];
      if (outcome.status === 'rejected') {
        errors[kind] = true;
        log(JSON.stringify({ event: 'tally_fetch_failed', path, error: String(outcome.reason?.stack ?? outcome.reason), at: new Date(now()).toISOString() }));
        return;
      }
      if (kind === 'core') { core = outcome.value; coreAt = now(); }
      if (kind === 'results') { results = outcome.value; resultSuccesses++; }
      if (kind === 'live') { live = outcome.value; resultSuccesses++; }
    });
    if (!core || (!results && !live)) throw new Error('Election data is not available yet');
    if (!errors.live) for (const [state, feed] of Object.entries(live?.st ?? {})) {
      if (feed.err && feedErrors.get(state) !== feed.err) {
        log(JSON.stringify({ event: 'tally_feed_failed', state, error: feed.err, at: new Date(now()).toISOString() }));
        feedErrors.set(state, feed.err);
      } else if (!feed.err) feedErrors.delete(state);
    }
    const connection = resultSuccesses === 0 ? 'offline' : Object.keys(errors).length ? 'partial' : 'ok';
    const data = normalizeData(core, results, live, latest, errors);
    latest = { ...data, schemaVersion: 1, connection,
      callsAvailable: Boolean(results && !isDry(results)),
      callsStale: Boolean(results && errors.results),
      refreshedAt: resultSuccesses ? new Date(now()).toISOString() : latest?.refreshedAt ?? null,
      attemptedAt: new Date(attemptAt).toISOString(), pollIntervalMs: REFRESH_MS,
      source: { name: "The People's Tally", url: ROOT + '/open-data/', license: 'CC BY 4.0' },
      feedStatus: Object.fromEntries(Object.entries(live?.st ?? {}).map(([state, value]) => [state, {
        feed: value.feed, mode: value.mode ?? null, source: value.src ?? null,
        url: value.url ?? null, error: Boolean(value.err), checkedAt: value.checked ?? null,
      }])),
    };
    return latest;
  }

  return {
    getState() { return { core, coreAt, results, live }; },
    async getSnapshot() {
      if (pending) return pending;
      if (now() - attemptAt < REFRESH_MS) {
        if (!latest) throw new Error('Election data is not available yet');
        return latest;
      }
      pending = refresh();
      try { return await pending; } finally { pending = null; }
    },
  };
}
