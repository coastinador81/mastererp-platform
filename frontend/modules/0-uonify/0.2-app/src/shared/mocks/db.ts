/**
 * «Base de datos» de la simulación: colecciones guardadas en sessionStorage para que
 * los datos simulados sobrevivan a una recarga dentro de la misma sesión, como un
 * backend real. Solo la usan los handlers de MSW (nunca los componentes).
 */
const PREFIX = 'uonify-mock:';

function read<T>(name: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + name);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(name: string, value: unknown): void {
  try { sessionStorage.setItem(PREFIX + name, JSON.stringify(value)); } catch { /* cuota llena: sigue en memoria */ }
}

export interface Collection<T extends { id: string }> {
  all(): T[];
  get(id: string): T | undefined;
  upsert(item: T): T;
  patch(id: string, patch: Partial<T>): T | undefined;
  remove(id: string): boolean;
  reset(): void;
}

/** Colección con semilla inicial (se aplica la primera vez o tras reset). */
export function collection<T extends { id: string }>(name: string, seed: () => T[] = () => []): Collection<T> {
  let cache: T[] | undefined;
  const load = (): T[] => {
    if (!cache) cache = read<T[]>(name) ?? seed();
    return cache;
  };
  const save = (items: T[]) => { cache = items; write(name, items); };
  return {
    all: () => [...load()],
    get: id => load().find(item => item.id === id),
    upsert(item) {
      const items = load();
      const index = items.findIndex(existing => existing.id === item.id);
      save(index >= 0 ? items.map((existing, i) => (i === index ? item : existing)) : [...items, item]);
      return item;
    },
    patch(id, patch) {
      const current = load().find(item => item.id === id);
      if (!current) return undefined;
      const next = { ...current, ...patch };
      save(load().map(item => (item.id === id ? next : item)));
      return next;
    },
    remove(id) {
      const items = load();
      const next = items.filter(item => item.id !== id);
      save(next);
      return next.length !== items.length;
    },
    reset() { save(seed()); },
  };
}

/** Valor único (p. ej. el saldo o la sesión) guardado igual que las colecciones. */
export function record<T>(name: string, seed: () => T) {
  let cache: T | undefined;
  return {
    get(): T {
      if (cache === undefined) cache = read<T>(name) ?? seed();
      return cache;
    },
    set(value: T): T {
      cache = value;
      write(name, value);
      return value;
    },
    update(updater: (current: T) => T): T {
      return this.set(updater(this.get()));
    },
  };
}
