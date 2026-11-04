import test from 'node:test';
import assert from 'node:assert/strict';

// Only the DOM operations used by this page; execute its real fetch/render path.
class Node {
  children = [];
  textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

test('Source timestamps keep neutral provenance for saved legacy and civicAPI results', async () => {
  const nodes = new Map(['health', 'result-sources', 'result-times', 'feed-sources'].map(id => [id, new Node()]));
  const original = { document: globalThis.document, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout };
  let finish;
  const rendered = new Promise(resolve => { finish = resolve; });
  const legacy = { id: 'S-FL-sp', office: 'S', state: 'FL', special: true, reported: true, status: 'called',
    source: "The People's Tally", sourceUrl: 'https://thepeoplestally.com/', calledBy: 'AP',
    asOf: '2026-11-04T01:02:00Z', calledAt: '2026-11-04T01:01:00Z', sourceStale: true };
  const civic = { ...legacy, id: 'S-GA', state: 'GA', special: false, source: 'civicAPI',
    sourceUrl: 'https://civicapi.org/', calledBy: 'civicAPI', calledAt: null, sourceStale: false };
  globalThis.document = { getElementById: id => nodes.get(id), createElement: () => new Node(),
    createTextNode: text => ({ textContent: text }) };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ connection: 'partial',
    refreshedAt: '2026-11-04T01:03:00Z', races: [legacy, civic], feedStatus: {} }) });
  globalThis.setTimeout = () => { finish(); };
  try {
    await import('../public/sources.js');
    await rendered;
    const [old, current] = nodes.get('result-times').children.map(node => node.textContent);
    assert.match(old, /source updated:/);
    assert.doesNotMatch(old, /chamber source updated:/);
    assert.ok(old.includes(new Date(legacy.asOf).toLocaleString('en-GB')));
    assert.ok(old.includes(`call: ${new Date(legacy.calledAt).toLocaleString('en-GB')}`));
    assert.match(old, /saved stale data/);
    assert.match(current, /source updated:/);
    assert.doesNotMatch(current, /chamber source updated:|saved stale data/);
    assert.match(current, /call: not provided by source/);
    assert.ok(current.includes(new Date(civic.asOf).toLocaleString('en-GB')));
  } finally {
    Object.assign(globalThis, original);
  }
});
