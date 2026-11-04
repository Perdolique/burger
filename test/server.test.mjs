import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { normalizeData } from '../lib/civic.mjs';
import { civicFeed } from './fixtures.mjs';

test('HTTP serves the OBS overlay, local fonts, and JSON without exposing design or project files', async () => {
  const data = { ...normalizeData({ S: civicFeed('S'), H: civicFeed('H') }), schemaVersion: 1, connection: 'ok' };
  const server = createAppServer({ store: { getSnapshot: async () => data } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/senate', '/house']) {
      const page = await fetch(origin + route);
      assert.equal(page.status, 200, route);
      assert.match(await page.text(), /id="election-card"/, route);
    }
    const font = await fetch(origin + '/fonts/nunito-900.ttf');
    assert.equal(font.status, 200); assert.equal(font.headers.get('content-type'), 'font/ttf');
    assert.equal((await font.arrayBuffer()).byteLength > 1000, true);
    const api = await fetch(origin + '/api/results');
    assert.equal(api.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await api.json()).chambers.S, { total: 35, called: 0, seats: { D: 0, R: 0, O: 0 }, callsAvailable: true, callsStale: false });
    for (const path of ['/package.json', '/usa-election-widget.fig', '/%2e%2e%2fpackage.json']) {
      assert.equal((await fetch(origin + path)).status, 404);
    }
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  } finally { server.close(); await once(server, 'close'); }
});
