import { bindings, defineConfig } from 'cf/config';
import * as entrypoint from './worker/index.ts' with { type: 'cf-worker' };

export default defineConfig({
  accountId: 'e19b9bdd14629a58c3f213b37a58281e',
  worker: {
    name: 'burgers-vote',
    entrypoint,
    compatibilityDate: '2026-11-03',
    domains: ['burger.perd.dev'],
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: 'burgers-vote-cache', id: '7ba4237a-ee8a-4c17-8fb2-35d44e41b716' }),
    },
    assets: { htmlHandling: 'none', runWorkerFirst: ['/', '/api/*', '/senate', '/house', '/sources'] },
    observability: {
      enabled: true,
      logs: { enabled: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 0.01 },
    },
  },
});
