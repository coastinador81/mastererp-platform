import { accountHandlers } from './accountHandlers';
import { brandsHandlers } from './brandsHandlers';
import { connectionsHandlers } from './connectionsHandlers';
import { privacyHandlers } from './privacyHandlers';
import { securityHandlers } from './securityHandlers';
import { teamHandlers } from './teamHandlers';

/**
 * Simulación del backend de Configuración: /account, /security, /connections,
 * /team, /brands y /privacy (contrato en la cabecera de cada archivo). Se registra
 * sola (src/shared/mocks/handlers.ts). /ai/usage la simula workspace y /billing/*
 * billing.
 */
export const handlers = [
  ...accountHandlers,
  ...securityHandlers,
  ...connectionsHandlers,
  ...teamHandlers,
  ...brandsHandlers,
  ...privacyHandlers,
];
