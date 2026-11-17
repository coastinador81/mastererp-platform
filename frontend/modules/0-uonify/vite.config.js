import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{dedupe:['react','react-dom'],alias:{jspdf:fileURLToPath(new URL('./node_modules/jspdf/dist/jspdf.es.min.js',import.meta.url))}},server:{fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]}}});
