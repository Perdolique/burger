import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeData } from '../lib/tally.mjs';
import { shortlist, topCandidates, raceColor, formatPercent, candidateLabel } from '../public/view-model.js';
import { interiorPoint, tether, calloutLayout } from '../public/map.js';
import { core, emptyResults, emptyLive, countingFlorida } from './fixtures.mjs';

test('Waiting races show both major parties and prefer the incumbent over another same-party candidate', () => {
  const race = { reported: false, candidates: [
    { name: 'Second Republican', party: 'R', incumbent: false },
    { name: 'Democratic Candidate', party: 'D', incumbent: false },
    { name: 'Current Republican', party: 'R', incumbent: true },
  ] };
  assert.deepEqual(topCandidates(race).map(candidate => candidate.name), ['Current Republican', 'Democratic Candidate']);
});

test('Recent calls and tight reported races take priority, tied leaders keep a neutral map', () => {
  const base = normalizeData(core, { ...emptyResults, races: { 'S-FL-sp': countingFlorida } }, emptyLive).races[0];
  const now = Date.parse('2026-11-04T02:00:00Z');
  const close = { ...base, id: 'S-WI', candidates: [{ name: 'A', party: 'D', pct: 49.5, votes: 495 }, { name: 'B', party: 'R', pct: 49.4, votes: 494 }] };
  const wide = { ...base, id: 'S-FL-sp', candidates: [{ name: 'A', party: 'D', pct: 70 }, { name: 'B', party: 'R', pct: 30 }] };
  const recent = { ...base, id: 'S-GA', status: 'called', calledAt: '2026-11-04T01:55:00Z' };
  const old = { ...base, id: 'S-OH-sp', status: 'called', calledAt: '2026-11-04T00:00:00Z' };
  assert.deepEqual(shortlist([wide, close, old, recent], 'S', now).map(race => race.id), ['S-GA', 'S-WI', 'S-FL-sp']);
  assert.equal(raceColor(close), '#285DB5');
  const tied = { ...close, candidates: [{ name: 'A', party: 'D', pct: 50, votes: 500 }, { name: 'B', party: 'R', pct: 50, votes: 500 }] };
  assert.equal(raceColor(tied), '#E9DFC9');
});

test('Shares have a readable 100-percent case and missing values stay unknown', () => {
  assert.equal(formatPercent(100), '100%');
  assert.equal(formatPercent(48.72), '48.7%');
  assert.equal(formatPercent(null), '—');
  assert.equal(candidateLabel('Daniel J. Sullivan Jr.'), 'Sullivan');
});

test('The marker stays inside a concave state and the straight tether ends on its edge', () => {
  const shape = [[0, 0], [12, 0], [12, 3], [3, 3], [3, 12], [0, 12]];
  const marker = interiorPoint([shape]);
  assert.equal(marker[0] > 0 && marker[1] > 0 && (marker[0] < 3 || marker[1] < 3), true);
  const line = tether([20, 1.5], [2, 1.5], [shape]);
  assert.deepEqual(line.end, [12, 1.5]);
  assert.equal(Math.abs(line.start[0] - 14.9) < 1e-9, true);
  assert.equal(tether([2, 1.5], [1, 1], [shape]), null);
});

test('All 50 state callouts leave their geographic marker outside the enlarged silhouette', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const states = [...html.matchAll(/<g\b([^>]*\bdata-state="([A-Z]{2})"[^>]*)>\s*<path d="([^"]+)"/g)];
  assert.equal(states.length, 50);
  for (const [, attributes, state, path] of states) {
    const [, x, y] = attributes.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    const parts = path.split('M').filter(Boolean).map(part => {
      const values = part.match(/-?\d+(?:\.\d+)?/g).map(Number);
      return Array.from({ length: values.length / 2 }, (_, index) => values.slice(index * 2, index * 2 + 2));
    });
    const points = parts.flat(), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const anchor = interiorPoint(parts);
    const layout = calloutLayout({ parts, bounds, x: Number(x), y: Number(y), anchor });
    const projected = parts.map(polygon => polygon.map(p => [p[0] * layout.scale + layout.x, p[1] * layout.scale + layout.y]));
    assert.notEqual(tether([anchor[0] + Number(x), anchor[1] + Number(y)], [anchor[0] * layout.scale + layout.x, anchor[1] * layout.scale + layout.y], projected), null, state);
    assert.ok(Math.max(bounds.width * layout.scale, bounds.height * layout.scale) >= 84, state);
  }
});
