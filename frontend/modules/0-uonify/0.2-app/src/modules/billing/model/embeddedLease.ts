let tail = Promise.resolve();

/** Stripe admite un formulario activo: esperar también las inicializaciones pendientes. */
export async function reserveEmbeddedCheckout(): Promise<() => void> {
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const previous = tail;
  tail = previous.then(() => current);
  await previous;
  let released = false;
  return () => { if (!released) { released = true; release(); } };
}
