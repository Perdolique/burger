import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare({ persistState: { path: '.cloudflare/state' }, inspectorPort: false })],
  server: { host: '127.0.0.1', port: 8793, strictPort: true },
});
