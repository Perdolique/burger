import { getSharedResults } from '../lib/shared-cache.mjs';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    if (url.pathname === '/api/results') {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      try {
        const data = await getSharedResults(env.DB);
        if (request.method === 'HEAD') return new Response(null, { headers });
        return Response.json(data, { headers });
      } catch (error) {
        const errorRecord = { event: 'widget_data_unavailable', error: String(error) };
        const errorMessage = JSON.stringify(errorRecord);
        console.error(errorMessage);
        const unavailableHeaders = { ...headers, 'retry-after': '60' };
        const body = request.method === 'HEAD' ? null : JSON.stringify({ error: 'Election data is temporarily unavailable', pollIntervalMs: 60_000 });
        return new Response(body, { status: 503, headers: unavailableHeaders });
      }
    }
    if (['/', '/senate', '/house'].includes(url.pathname)) url.pathname = '/index.html';
    if (url.pathname === '/sources') url.pathname = '/sources.html';
    const assetRequest = new Request(url, request);
    return env.ASSETS.fetch(assetRequest);
  },
};
