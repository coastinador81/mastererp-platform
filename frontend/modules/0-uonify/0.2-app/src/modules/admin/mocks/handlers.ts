import { authHandlers } from './authHandlers';
import { customerHandlers } from './customerHandlers';
import { opsHandlers } from './opsHandlers';

/**
 * Simulación de la API de administración: SOLO /api/admin/*. Precios, configuración,
 * artículos y tickets se cambian con los endpoints de billing y help (sus handlers).
 */
export const handlers = [...authHandlers, ...customerHandlers, ...opsHandlers];
