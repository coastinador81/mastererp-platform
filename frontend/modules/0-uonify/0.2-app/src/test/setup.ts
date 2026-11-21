import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// En la CI (runner de 2 vCPU, dos procesos de Vitest y 253 entornos jsdom) un findBy o un waitFor
// puede tardar más del segundo por defecto sin que nada falle: el 21-11-2026 un run lento (368 s
// frente a 267 s) tumbó así una prueba del ERP. En la CI se espera hasta 5 s; en local sigue el
// segundo, que avisa antes. No es un reintento: lo que falla de verdad sigue fallando.
// process se lee por globalThis porque los tipos de la app (tsconfig.app.json) no incluyen Node.
const entorno = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
if (entorno?.CI) configure({ asyncUtilTimeout: 5000 });
