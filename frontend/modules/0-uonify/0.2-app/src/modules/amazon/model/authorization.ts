import type { AmazonFlow, AmazonState } from '../api/amazonApi';

export function authorizationUrl(flow: AmazonFlow, loginUri: string): string {
  let url: URL;
  let expected: URL;
  try { url = new URL(flow.authUrl); expected = new URL(loginUri); }
  catch { throw new Error('No se ha podido abrir una autorización válida de Amazon.'); }
  // El gateway crea la cookie pública; el navegador no salta directamente a Amazon.
  if (expected.protocol !== 'https:' || expected.username || expected.password || expected.search || expected.hash
    || url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash
    || [...url.searchParams.keys()].length !== 1 || !/^[A-Za-z0-9_-]{40,64}$/.test(url.searchParams.get('launch') ?? '')
    || typeof flow.flowId !== 'string' || !flow.flowId.trim() || flow.flowId.length > 256) {
    throw new Error('No se ha podido abrir una autorización válida de Amazon.');
  }
  return url.href;
}

export function amazonReady(state?: AmazonState): boolean {
  return Boolean(state?.available && state.setup?.httpsReady && state.setup.applicationReady && state.setup.credentialsReady && state.setup.loginUri && state.setup.redirectUri);
}

export function amazonFlowError(code?: string): string {
  if (code === 'access_denied') return 'No has concedido el permiso de Amazon. Puedes volver a intentarlo cuando quieras.';
  if (code === 'expired' || code === 'flow_expired') return 'La autorización ha caducado. Vuelve a conectar Amazon para empezar de nuevo.';
  if (code === 'account_mismatch' || code === 'seller_mismatch') return 'La cuenta de vendedor no coincide con la solicitud. Vuelve a empezar desde la cuenta correcta.';
  return 'No se ha completado la autorización de Amazon. Tu trabajo sigue en Uonify; puedes volver a intentarlo.';
}
