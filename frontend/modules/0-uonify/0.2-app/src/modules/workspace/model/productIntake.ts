export interface ProductIntakeContext { id: string; revision: number }

/** Solo admite referencias persistidas del asistente; nunca instrucciones del mensaje. */
export function productIntakeOf(value: unknown, role: unknown): ProductIntakeContext | undefined {
  if (role !== 'assistant' || typeof value !== 'object' || value === null) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)
    || typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 1) return undefined;
  return { id: item.id, revision: item.revision };
}
