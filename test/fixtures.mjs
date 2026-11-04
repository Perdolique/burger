const SENATE_STATES = [
  'fl', 'ak', 'al', 'ar', 'co', 'de', 'ga', 'ia', 'id', 'il', 'ks', 'ky', 'la', 'ma', 'me', 'mi', 'mn', 'ms',
  'mt', 'nc', 'ne', 'nh', 'nj', 'nm', 'oh', 'ok', 'or', 'ri', 'sc', 'sd', 'tn', 'tx', 'va', 'wv', 'wy',
];
const HOUSE_DISTRICTS = {
  ak: 1, al: 7, ar: 4, az: 9, ca: 52, co: 8, ct: 5, de: 1, fl: 28, ga: 14,
  hi: 2, ia: 4, id: 2, il: 17, in: 9, ks: 4, ky: 6, la: 6, ma: 9, md: 8,
  me: 2, mi: 13, mn: 8, mo: 8, ms: 4, mt: 2, nc: 14, nd: 1, ne: 3, nh: 2,
  nj: 12, nm: 3, nv: 4, ny: 26, oh: 15, ok: 5, or: 6, pa: 17, ri: 2, sc: 7,
  sd: 1, tn: 9, tx: 38, ut: 4, va: 11, vt: 1, wa: 10, wi: 8, wv: 2, wy: 1,
};

export const countingFlorida = {
  name: 'Florida', type: 'State', election_id: 87068, percent_reporting: 10,
  candidates: [
    { name: 'Red Senator', party: 'Republican', votes: 510, percent: 51, winner: false, incumbent: true },
    { name: 'Blue Senator', party: 'Democratic', votes: 490, percent: 49, winner: false, incumbent: false },
  ],
};
export const calledFlorida = { ...countingFlorida,
  candidates: countingFlorida.candidates.map(candidate => ({ ...candidate, winner: candidate.party === 'Republican' })),
};

export function civicFeed(office, overrides = {}, updated = '2026-11-04T01:00:00Z') {
  const keys = office === 'S' ? SENATE_STATES : Object.entries(HOUSE_DISTRICTS).flatMap(([state, count]) =>
    Array.from({ length: count }, (_, index) => `${state}-${count === 1 ? 'al' : String(index + 1).padStart(2, '0')}`));
  return { election_name: office === 'S' ? 'United States Senate' : 'United States House of Representatives',
    election_type: office === 'S' ? 'US Senate' : 'House of Representatives', election_scope: 'General',
    election_date: '2026-11-03T05:00:00.000Z', country: 'US', test_data: false, last_updated: updated,
    // Deliberately different from individual winners: these totals must never award seats.
    candidates: [{ name: 'Democrats', party: 'Democratic', seats: 54 }, { name: 'Republicans', party: 'Republican', seats: 44 }],
    region_results: Object.fromEntries(keys.map((key, index) => [key, overrides[key] ?? {
      name: key, election_id: 100000 + index, percent_reporting: 0,
      candidates: [
        { name: office === 'S' ? 'Red Senator' : 'Red House', party: 'Republican', votes: 0, percent: 0, winner: false, incumbent: true },
        { name: office === 'S' ? 'Blue Senator' : 'Blue House', party: 'Democratic', votes: 0, percent: 0, winner: false, incumbent: false },
      ],
    }])),
  };
}
