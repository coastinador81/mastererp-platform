/**
 * <AuthDialogs/> se pinta una vez por maquetación; si por error hubiera dos a la
 * vez, solo el primero montado pinta los diálogos (los ids del prototipo son únicos).
 */
let hosts: symbol[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(listener => listener());

export function claimHost(id: symbol): () => void {
  hosts = [...hosts, id];
  emit();
  return () => {
    hosts = hosts.filter(host => host !== id);
    emit();
  };
}

export function subscribeHosts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const activeHost = (): symbol | null => hosts[0] ?? null;

/** Solo pruebas. */
export function resetHosts(): void {
  hosts = [];
  emit();
}
