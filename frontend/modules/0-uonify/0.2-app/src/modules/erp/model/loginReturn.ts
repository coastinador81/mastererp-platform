/**
 * Resultado con el que el servidor devuelve a la app tras el acceso a MasterERP en la misma
 * pestaña (/espacio?service=erp&erp=<resultado>, mastererp_oauth.finish). La entrada del espacio
 * cambia esa URL por /espacio/erp en la primera pintura, así que se lee al cargar el documento;
 * la tarjeta que lo muestra lo da por atendido. El estado real lo decide siempre el servidor.
 */
let pending: string | null = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('erp');

const TEXTS: Record<string, string> = {
  account_mismatch: 'La cuenta de MasterERP elegida no coincide con la que conectaste. Desconecta para cambiar de cuenta. La otra cuenta no se ha conectado.',
  denied: 'Has cancelado el acceso a MasterERP. Puedes volver a conectar cuando quieras.',
  session_or_subscription: 'Tu sesión de Uonify ha cambiado o no tiene una suscripción vigente. Vuelve a entrar y conecta de nuevo.',
};

/** Aviso de la vuelta, o null si volvió bien o no hubo vuelta. */
export function loginReturnNotice(): string | null {
  // «not_linked» lo explica el estado de la conexión («todavía no tiene acceso asignado»).
  if (!pending || pending === 'return' || pending === 'not_linked') return null;
  return TEXTS[pending] ?? 'No se ha completado el acceso a MasterERP. Puedes volver a intentarlo.';
}

/** El aviso solo se enseña en la primera tarjeta que se pinta tras la vuelta. */
export function consumeLoginReturn(): void {
  pending = null;
}
