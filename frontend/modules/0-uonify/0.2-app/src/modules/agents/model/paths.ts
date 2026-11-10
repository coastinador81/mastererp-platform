/** Rutas del servicio Agentes dentro del espacio de trabajo. */
export const AGENTS_BASE_PATH = '/espacio/agentes';

/** Segmento del asistente «Crear agente» (/espacio/agentes/crear). */
export const CREATE_SEGMENT = 'crear';

/** Un apartado del menú: /espacio/agentes/predeterminados. */
export const sectionPath = (section: string): string => `${AGENTS_BASE_PATH}/${section}`;

/** Ficha de un agente: /espacio/agentes/predeterminados/finanzas. */
export const agentPath = (section: string, agent: string): string => `${sectionPath(section)}/${encodeURIComponent(agent)}`;

export const createPath = (): string => sectionPath(CREATE_SEGMENT);
