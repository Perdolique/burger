import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createCivicStore } from './lib/civic.mjs';

const publicDirectory = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

export function createAppServer({ store = createCivicStore() } = {}) {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/results') {
        try {
          const snapshot = await store.getSnapshot();
          response.writeHead(200, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
          response.end(request.method === 'HEAD' ? undefined : JSON.stringify(snapshot));
        } catch (error) {
          console.error(JSON.stringify({ event: 'widget_data_unavailable', error: String(error.stack ?? error) }));
          response.writeHead(503, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store', 'Retry-After': '60' });
          response.end(JSON.stringify({ error: 'Election data is temporarily unavailable', pollIntervalMs: 60_000 }));
        }
        return;
      }
      const route = ['/', '/senate', '/house'].includes(url.pathname) ? 'index.html'
        : url.pathname === '/sources' ? 'sources.html' : decodeURIComponent(url.pathname).slice(1);
      const path = resolve(publicDirectory, route);
      const type = types[extname(path)];
      if (!path.startsWith(publicDirectory + sep) || !type) { response.writeHead(404); response.end(); return; }
      const content = await readFile(path);
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR' && !(error instanceof URIError)) console.error(error);
      response.writeHead(404); response.end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`OBS widget: http://127.0.0.1:${port}/ (480 × 360)`);
    console.log(`Senate only: http://127.0.0.1:${port}/senate`);
    console.log(`House only: http://127.0.0.1:${port}/house`);
    console.log(`Sources and status: http://127.0.0.1:${port}/sources`);
  });
  server.on('error', error => { console.error(error); process.exitCode = 1; });
}
