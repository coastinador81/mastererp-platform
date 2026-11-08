import { create } from 'zustand';

const KEY = 'uonify.amazon.intent';
export const AMAZON_INTENT_TTL = 600_000;
interface PendingIntent { id: string; createdAt: number }
const valid = (value: unknown): value is PendingIntent => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PendingIntent>;
  return typeof item.id === 'string' && !!item.id.trim() && item.id.length <= 512
    && typeof item.createdAt === 'number' && item.createdAt <= Date.now() && item.createdAt + AMAZON_INTENT_TTL > Date.now();
};
function read(): PendingIntent | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (valid(value)) return value;
    sessionStorage.removeItem(KEY);
  } catch { /* La sesión puede impedir almacenamiento; el flujo sigue en memoria. */ }
  return null;
}

/** Solo el identificador opaco del traspaso, sin códigos ni credenciales de Amazon. */
export const useAmazonIntent = create<{ pending: PendingIntent | null }>(() => ({ pending: read() }));

export function rememberAmazonIntent(id: string): void {
  const current = useAmazonIntent.getState().pending;
  const pending = current?.id === id && valid(current) ? current : { id, createdAt: Date.now() };
  if (!valid(pending)) { clearAmazonIntent(); return; }
  try { sessionStorage.setItem(KEY, JSON.stringify(pending)); } catch { /* Fallback efímero en memoria. */ }
  useAmazonIntent.setState({ pending });
}

export function clearAmazonIntent(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* Puede estar deshabilitado. */ }
  useAmazonIntent.setState({ pending: null });
}

export function amazonIntentQuery(search: string): { id: string; search: string } | null {
  const params = new URLSearchParams(search);
  const id = params.get('amazon_intent');
  if (id === null) return null;
  params.delete('amazon_intent');
  return { id, search: params.size ? `?${params}` : '' };
}
