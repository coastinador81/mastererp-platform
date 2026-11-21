/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/** Entrada y salida de la compilación del prerender (ver scripts/prerender.mjs). */
export const PRERENDER_ENTRY = 'src/modules/public-site/prerender/entry-server.tsx';
export const PRERENDER_OUT_DIR = 'node_modules/.cache/uonify-prerender';

// Librerías que cambian poco y usan todas las vistas: en su propio archivo, el navegador
// las guarda en caché entre despliegues y las descarga en paralelo con la aplicación.
const VENDOR = /node_modules[\\/](react|react-dom|scheduler|react-router|@tanstack|zustand)[\\/]/;

// Uonify frontend. En desarrollo los datos vienen de MSW (src/shared/mocks):
// la app llama a las mismas rutas que implementará el backend.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: {
    '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false, ws: true },
  } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: isSsrBuild
    ? {
        // `vite build --ssr`: solo el prerender, fuera de dist y sin la carpeta public.
        outDir: PRERENDER_OUT_DIR,
        emptyOutDir: true,
        copyPublicDir: false,
        rolldownOptions: { input: PRERENDER_ENTRY },
      }
    : {
        rolldownOptions: {
          output: { codeSplitting: { groups: [{ name: 'vendor', test: VENDOR }] } },
        },
      },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
    // En la CI (runner de 2 vCPU) las esperas de src/test/setup.ts llegan a 5 s: cada prueba, hasta 15.
    testTimeout: process.env.CI ? 15_000 : 5_000,
  },
}));
