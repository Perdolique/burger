import { raceTitle } from './view-model.js';

function link(label, href) {
  const node = document.createElement('a');
  node.textContent = label;
  try {
    const url = new URL(href);
    if (['https:', 'http:'].includes(url.protocol)) node.href = url.href;
  } catch { /* A missing upstream URL remains plain text. */ }
  return node;
}

async function refresh() {
  const health = document.getElementById('health');
  try {
    const response = await fetch('/api/results', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const labels = { ok: 'API connected', partial: 'Some requests failed', offline: 'Offline; showing saved results' };
    health.textContent = `${labels[data.connection]}. Last successful sync: ${data.refreshedAt ? new Date(data.refreshedAt).toLocaleString('en-GB') : 'not yet'}. Refreshes once per minute.`;
    const resultSources = document.getElementById('result-sources');
    resultSources.replaceChildren();
    const unique = new Map();
    for (const race of data.races) {
      if (race.source && race.sourceUrl) unique.set(race.sourceUrl, race.source);
      if (race.calledBy) unique.set(`call:${race.calledBy}`, race.calledBy);
    }
    for (const [url, label] of unique) {
      const item = document.createElement('li');
      item.append(url.startsWith('call:') ? document.createTextNode(`Calls: ${label}`) : link(label, url));
      resultSources.append(item);
    }
    if (!unique.size) resultSources.append(document.createTextNode('No results yet.'));
    const times = document.getElementById('result-times');
    times.replaceChildren();
    const formatTime = value => value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString('en-GB') : 'not provided by source';
    for (const race of data.races.filter(race => race.reported || race.status === 'called')) {
      const item = document.createElement('li');
      const office = race.office === 'S' ? 'Senate' : 'House of Representatives';
      item.textContent = `${office} · ${raceTitle(race)} — chamber source updated: ${formatTime(race.asOf)}` +
        (race.status === 'called' ? `; call: ${formatTime(race.calledAt)}` : '') +
        (race.sourceStale ? '; saved stale data' : '');
      times.append(item);
    }
    if (!times.children.length) times.append(document.createTextNode('No published results yet.'));
    const feeds = document.getElementById('feed-sources'); feeds.replaceChildren();
    for (const [state, feed] of Object.entries(data.feedStatus).sort(([a], [b]) => a.localeCompare(b))) {
      const item = document.createElement('li');
      item.append(link(`${state === 'S' ? 'Senate' : state === 'H' ? 'House' : state}: ${feed.source ?? 'source'}`, feed.url));
      item.append(document.createTextNode(` — ${feed.mode === 'dry' ? 'test mode; numbers excluded' : feed.error ? 'source error' : feed.feed === 'ok' ? 'connected' : 'waiting for data'}`));
      feeds.append(item);
    }
  } catch (error) {
    console.error('Source status unavailable', error);
    health.textContent = 'Source status is unavailable. Retrying in one minute.';
  }
  setTimeout(refresh, 60_000);
}
refresh();
