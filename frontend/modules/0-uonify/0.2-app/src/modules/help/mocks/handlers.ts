/**
 * Simulación MSW del módulo de ayuda: /help/* (centro de ayuda, artículos y su CRUD
 * para admin, búsqueda, valoraciones y configuración) y /support/* (Uony de soporte,
 * tickets y videollamadas). Contrato completo en api/paths.ts.
 */
import { assistantHandler } from './assistantHandler';
import { helpHandlers } from './helpHandlers';
import { supportHandlers } from './supportHandlers';

export const handlers = [...helpHandlers, assistantHandler, ...supportHandlers];
