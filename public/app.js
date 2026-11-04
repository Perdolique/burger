import { textSlot, numberSlot, animate } from './motion.js';
import { MapView } from './map.js';
import { validPayload, mergeCachedResults } from './results.js';
import { shortlist, topCandidates, candidateLabel, formatPercent, raceTitle, raceColor, PARTY_COLORS } from './view-model.js';

const POLL_MS = 60_000;
// Preserve existing OBS storage across the source migration.
const CACHE_KEY = 'tally-obs-results-v1';
const fixedOffice = { '/senate': 'S', '/house': 'H' }[window.location.pathname] ?? null;
if (fixedOffice) document.title = `${fixedOffice === 'S' ? 'Senate' : 'House of Representatives'} · US Elections`;
const widget = document.getElementById('widget');
const svg = document.getElementById('election-card');
const summary = document.getElementById('widget-summary');
const map = new MapView(svg);
const text = {
  chamber: textSlot(svg, { name: 'chamber', x: 16, y: 6, width: 444, height: 43, baseline: 37, size: 30, minSize: 27, weight: 900 }),
  called: textSlot(svg, { name: 'called', x: 16, y: 143, width: 444, height: 32, baseline: 166, size: 22, weight: 700, color: '#5C5347' }),
  race: textSlot(svg, { name: 'race', x: 228, y: 181, width: 232, height: 36, baseline: 208, size: 25, minSize: 22, weight: 900 }),
  first: textSlot(svg, { name: 'first-candidate', x: 228, y: 220, width: 144, height: 34, baseline: 247, size: 22, weight: 800 }),
  second: textSlot(svg, { name: 'second-candidate', x: 228, y: 263, width: 144, height: 34, baseline: 290, size: 22, weight: 800 }),
  updated: textSlot(svg, { name: 'updated', x: 16, y: 320, width: 213, height: 34, baseline: 344, size: 22, weight: 700, color: '#5C5347' }),
  status: textSlot(svg, { name: 'status', x: 232, y: 320, width: 228, height: 34, baseline: 344, size: 22, weight: 800, align: 'end' }),
};
const seats = [88, 238, 388].map((center, index) => numberSlot(svg, {
  name: ['D', 'R', 'O'][index], x: 19 + index * 150, y: 58, width: 138, height: 76, center, baseline: 115, size: 60,
}));
const percentages = [247, 290].map((baseline, index) => numberSlot(svg, {
  name: `candidate-${index}`, x: 378, y: index ? 263 : 220, width: 84, height: 34, right: 460, baseline, size: 26,
}));
const bars = [256, 299].map(y => {
  const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bar.setAttribute('x', '228'); bar.setAttribute('y', String(y)); bar.setAttribute('height', '5');
  bar.setAttribute('width', '0'); svg.append(bar);
  return { element: bar, value: 0, cancel: () => {} };
});

let data = null;
let office = fixedOffice ?? 'S';
let position = 0;
let raceId = null;
let nextPoll;
let failedWithoutData = false;

function currentRace(forceSelection = false) {
  if (!data) return null;
  const choices = shortlist(data.races, office);
  if (!forceSelection && raceId) {
    const existing = data.races.find(race => race.id === raceId && race.office === office);
    if (existing) return existing;
  }
  const chosen = choices[position % Math.max(1, choices.length)] ?? null;
  raceId = chosen?.id ?? null;
  return chosen;
}

function render(forceSelection = false) {
  const race = currentRace(forceSelection);
  const chamber = data?.chambers[office];
  const callsKnown = chamber && (chamber.callsAvailable ?? data.callsAvailable !== false);
  const candidates = topCandidates(race);
  const offline = data?.connection === 'offline' || (!data && failedWithoutData);
  const stale = !offline && (race?.sourceStale || (chamber?.callsStale ?? data?.callsStale));
  text.chamber.set(office === 'S' ? 'Senate' : 'House of Representatives', { size: office === 'S' ? 30 : 27 });
  text.called.set(callsKnown ? `Called ${chamber.called} of ${chamber.total}` : chamber ? 'Seat totals unavailable' : offline ? 'Retrying in one minute' : 'Fetching results…');
  ['D', 'R', 'O'].forEach((party, index) => seats[index].set(callsKnown ? chamber.seats[party] : '—'));
  text.race.set(race ? raceTitle(race) : offline ? 'No data' : data ? 'No races' : 'Loading…');
  for (let index = 0; index < 2; index++) {
    const candidate = candidates[index];
    text[index ? 'second' : 'first'].set(candidate ? candidateLabel(candidate.name) : '—', {
      color: candidate ? PARTY_COLORS[candidate.party] ?? PARTY_COLORS.O : '#5C5347',
    });
    percentages[index].set(formatPercent(race?.reported ? candidate?.pct : null));
    const bar = bars[index];
    const target = (candidate?.pct ?? 0) * 232 / 100;
    bar.cancel();
    const previous = bar.value;
    bar.element.setAttribute('fill', candidate ? PARTY_COLORS[candidate.party] ?? PARTY_COLORS.O : '#5C5347');
    bar.cancel = animate(450, t => {
      bar.value = previous + (target - previous) * t;
      bar.element.setAttribute('width', String(bar.value));
    });
  }
  map.set(race?.state, raceColor(race));
  const refreshed = data?.refreshedAt ? new Date(data.refreshedAt) : null;
  const updatedLabel = refreshed && Number.isFinite(refreshed.getTime())
    ? `Updated ${refreshed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Updating…';
  text.updated.set(updatedLabel);
  let status = !data ? 'Loading' : !race || !race.reported ? 'Waiting' : 'Counting';
  if (race?.status === 'called') {
    status = /\b(AP|Associated Press)\b/i.test(race.calledBy) ? 'Winner · AP' : 'Winner';
  }
  if (race?.feedError && !race.reported) status = 'No data';
  if (stale) status = 'Stale data';
  if (offline) status = 'Offline';
  text.status.set(status, { color: offline || stale ? '#A52A27' : '#26201A' });
  widget.dataset.chamber = office;
  widget.dataset.race = race?.id ?? '';
  widget.dataset.connection = data?.connection ?? (offline ? 'offline' : 'loading');
  widget.dataset.updatedAt = data?.refreshedAt ?? '';
  const readable = [office === 'S' ? 'Senate' : 'House of Representatives',
    callsKnown ? `Called ${chamber.called} of ${chamber.total}. Democrats ${chamber.seats.D}, Republicans ${chamber.seats.R}, Others ${chamber.seats.O}.` : chamber ? 'Called-seat totals are not available yet.' : offline ? 'No results yet. Retrying in one minute.' : 'Fetching results.',
    race ? raceTitle(race) : '',
    ...candidates.map(candidate => `${candidate.name}: ${formatPercent(race?.reported ? candidate.pct : null)}.`),
    status, updatedLabel, race?.calledBy ? `Call source: ${race.calledBy}.` : '',
    race?.source ? `Source: ${race.source}.` : '',
  ].filter(Boolean).join(' ');
  if (summary.textContent !== readable) summary.textContent = readable;
}

function connectionFailed() {
  if (data) data = { ...data, connection: 'offline' };
  else failedWithoutData = true;
  render();
}

async function poll() {
  clearTimeout(nextPoll);
  try {
    const response = await fetch('/api/results', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Widget API: HTTP ${response.status}`);
    const next = await response.json();
    if (!validPayload(next)) throw new Error('Invalid widget data response');
    failedWithoutData = false;
    data = mergeCachedResults(next, data);
    render();
    if (data.connection !== 'offline') {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (error) { console.warn('Results cache unavailable', error); }
    }
  } catch (error) {
    console.error('Election results refresh failed', error);
    connectionFailed();
  } finally {
    nextPoll = setTimeout(poll, POLL_MS);
  }
}

try {
  const saved = JSON.parse(localStorage.getItem(CACHE_KEY));
  if (validPayload(saved)) data = { ...saved, connection: 'offline' };
} catch (error) { console.warn('Could not read cached election results', error); }

render();
poll();
setInterval(() => {
  position++;
  if (position === 3) {
    position = 0;
    if (!fixedOffice) office = office === 'S' ? 'H' : 'S';
  }
  raceId = null; render(true);
}, 12_000);
document.fonts.ready.then(() => Object.values(text).forEach(slot => slot.refit()));
