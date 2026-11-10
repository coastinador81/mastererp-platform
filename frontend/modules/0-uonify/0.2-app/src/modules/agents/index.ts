/**
 * Módulo agents: servicio Agentes del espacio de trabajo (Centro de Agentes del equipo con
 * la mesa de Producto). Sus rutas (/espacio/agentes…) se declaran en routes.tsx y se
 * registran solas. Los agentes personalizados viven en memoria durante la sesión.
 *
 *   AGENTS_BASE_PATH        /espacio/agentes
 *   sectionPath(apartado)   /espacio/agentes/predeterminados
 *   agentPath(apartado, id) /espacio/agentes/predeterminados/finanzas
 */
export { AGENTS_BASE_PATH, sectionPath, agentPath, createPath } from './model/paths';
export { PREDEFINED_AGENTS } from './model/catalog';
