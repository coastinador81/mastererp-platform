export const CONNECTION_PROVIDERS = ['amazon', 'cloud', 'drive', 'blender', 'account'] as const;
export type ConnectionProvider = typeof CONNECTION_PROVIDERS[number];

export const isConnectionProvider = (value: unknown): value is ConnectionProvider =>
  typeof value === 'string' && CONNECTION_PROVIDERS.some(provider => provider === value);

/** Acción de presentación: nunca contiene rutas, permisos ni órdenes de conexión. */
export interface ConnectionAction {
  provider: ConnectionProvider;
  action: 'manage';
}

/** Solo las herramientas del asistente pueden presentar controles conocidos. */
export function connectionActionsOf(value: unknown, role: unknown): ConnectionAction[] | undefined {
  if (role !== 'assistant' || !Array.isArray(value)) return undefined;
  const providers = new Set<ConnectionProvider>();
  for (const item of value) {
    if (typeof item === 'object' && item !== null && isConnectionProvider(item.provider) && item.action === 'manage') providers.add(item.provider);
  }
  return providers.size ? [...providers].map(provider => ({ provider, action: 'manage' })) : undefined;
}
