export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
};
export const PARTY_COLORS = { D: '#285DB5', R: '#B63C34', O: '#5C5347' };

export function topCandidates(race) {
  if (!race) return [];
  if (!race.reported) {
    const ballot = race.candidates.slice().sort((a, b) => Number(b.incumbent) - Number(a.incumbent));
    const major = ['R', 'D'].map(party => ballot.find(candidate => candidate.party === party)).filter(Boolean);
    return [...major, ...ballot.filter(candidate => !major.includes(candidate))].slice(0, 2);
  }
  const preferred = { R: 0, D: 1, O: 2 };
  return race.candidates.slice().sort((a, b) => {
    const delta = (b.pct ?? -1) - (a.pct ?? -1) || (b.votes ?? -1) - (a.votes ?? -1);
    if (delta) return delta;
    return preferred[a.party] - preferred[b.party] || a.name.localeCompare(b.name);
  }).slice(0, 2);
}

export function shortlist(races, office, now = Date.now()) {
  const contests = races.filter(race => race.office === office);
  const timestamp = race => Date.parse(race.calledAt ?? race.asOf ?? '') || 0;
  const recent = contests.filter(race => race.status === 'called' && race.calledAt && now - timestamp(race) >= 0 && now - timestamp(race) < 15 * 60_000)
    .sort((a, b) => timestamp(b) - timestamp(a) || a.id.localeCompare(b.id)).slice(0, 2);
  const gap = race => {
    const top = topCandidates(race);
    return top.length > 1 && top[0].pct !== null && top[1].pct !== null ? top[0].pct - top[1].pct : 100;
  };
  const remaining = contests.filter(race => race.status !== 'called').sort((a, b) =>
    Number(b.reported) - Number(a.reported) || (a.reported ? gap(a) - gap(b) : 0) ||
    Math.abs(a.rating - 3) - Math.abs(b.rating - 3) || a.id.localeCompare(b.id));
  const chosen = [...recent, ...remaining].slice(0, 3);
  if (chosen.length < 3) {
    chosen.push(...contests.filter(race => race.status === 'called' && !chosen.some(item => item.id === race.id))
      .sort((a, b) => timestamp(b) - timestamp(a) || a.id.localeCompare(b.id)).slice(0, 3 - chosen.length));
  }
  return chosen;
}

export function candidateLabel(name) {
  const clean = String(name ?? '').replace(/,?\s+(Jr|Sr|II|III|IV)\.?$/i, '').trim();
  return clean.split(/\s+/).at(-1) || '—';
}

export function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: value >= 99.95 ? 0 : 1,
    maximumFractionDigits: value >= 99.95 ? 0 : 1 }).format(Math.max(0, Math.min(100, value))) + '%';
}

export function raceTitle(race) {
  if (!race) return 'No data';
  const state = STATE_NAMES[race.state] ?? race.state;
  return race.office === 'H' && race.district !== 'AL' ? `${state} · ${Number(race.district)}` : state;
}

export function raceColor(race) {
  if (!race) return '#E9DFC9';
  if (race.status === 'called') return PARTY_COLORS[race.winnerParty] ?? PARTY_COLORS.O;
  const [first, second] = topCandidates(race);
  if (!race.reported || !first || (second && first.pct === second.pct && first.votes === second.votes)) return '#E9DFC9';
  return PARTY_COLORS[first.party] ?? PARTY_COLORS.O;
}
