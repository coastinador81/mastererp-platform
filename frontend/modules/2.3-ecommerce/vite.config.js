import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  resolve: {dedupe: ['react', 'react-dom']},
  server: {fs: {allow: [fileURLToPath(new URL('../..', import.meta.url))]}},
});
