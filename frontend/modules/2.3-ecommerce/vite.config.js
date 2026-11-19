import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {devApiProxy} from '../../shared/dev-api-proxy.mjs';

export default defineConfig({
  resolve: {dedupe: ['react', 'react-dom']},
  server: {fs: {allow: [fileURLToPath(new URL('../..', import.meta.url))]}, proxy: devApiProxy()},
});
