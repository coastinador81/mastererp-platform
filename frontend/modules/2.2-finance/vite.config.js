import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const rootDir = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  resolve:{dedupe:['react','react-dom']},
  server:{fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]}},
  build:{
    rollupOptions:{
      input:{
        finance:path.resolve(rootDir,'index.html'),
        'purchases-harness':path.resolve(rootDir,'purchases-harness.html'),
      },
    },
  },
});
