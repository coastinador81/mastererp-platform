import type { RequestHandler } from 'msw';

/**
 * Reúne las simulaciones de todos los módulos: cada uno exporta `handlers` desde
 * src/modules/<módulo>/mocks/handlers.ts. No hay que tocar este archivo.
 */
const modules = import.meta.glob<{ handlers?: RequestHandler[] }>('../../modules/*/mocks/handlers.ts', { eager: true });

export const handlers: RequestHandler[] = Object.values(modules).flatMap(m => m.handlers ?? []);
