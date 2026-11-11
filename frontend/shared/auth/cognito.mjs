// Access tokens live only in memory. PKCE transaction data is one-use session storage.
const transactionKey = 'mastererp.dev.pkce';
const refreshKey = 'mastererp.dev.refresh';
let session = null;
let refreshing = null;

async function authFetch(config, url, options) {
  const timeoutMs = Number(config.requestTimeoutMs || 0);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } catch (error) {
    if (controller.signal.aborted) throw new Error('La conexión está tardando demasiado. Intenta nuevamente.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function pkceChallenge(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export async function authorizationRequest(config, options = {}) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const url = new URL('/oauth2/authorize', config.loginBaseUrl);
  const params = {client_id: config.clientId, response_type: 'code',
    redirect_uri: config.callbackUrl, scope: config.scopes.join(' '), state,
    code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256'};
  if (options.identityProvider) params.identity_provider = options.identityProvider;
  if (options.screen === 'signup') params.lang = 'es';
  if (options.prompt === 'none' || options.prompt === 'login') params.prompt = options.prompt;
  url.search = new URLSearchParams(params).toString();
  return {url: url.href, verifier, state, createdAt: Date.now()};
}

export async function login(config, options = {}) {
  const selection = sessionStorage.getItem('mastererp.dev.selection');
  clearSession();
  if (selection) sessionStorage.setItem('mastererp.dev.selection', selection);
  const transaction = await authorizationRequest(config, options);
  sessionStorage.setItem(transactionKey, JSON.stringify({...transaction,
    clientId: config.clientId, callbackUrl: config.callbackUrl, returnHash: window.location.hash?.startsWith('#/') ? window.location.hash : '#/'}));
  window.location.assign(transaction.url);
}

export async function completeLogin(config, href = window.location.href) {
  const callback = new URL(href);
  const raw = sessionStorage.getItem(transactionKey);
  sessionStorage.removeItem(transactionKey);
  // Remove the authorization code even on failure. Tokens never enter URLs.
  window.history.replaceState(null, '', '/');
  const transaction = raw ? JSON.parse(raw) : null;
  if (!transaction || callback.origin + callback.pathname !== config.callbackUrl ||
      callback.searchParams.get('state') !== transaction.state ||
      transaction.clientId !== config.clientId || transaction.callbackUrl !== config.callbackUrl ||
      Date.now() - transaction.createdAt > 300000 || transaction.createdAt > Date.now()) {
    clearSession();
    throw new Error('No se pudo validar el inicio de sesión. Vuelve a intentarlo.');
  }
  const code = callback.searchParams.get('code');
  if (!code || callback.searchParams.has('error')) throw new Error('El acceso no se completó.');
  const result = await authFetch(config, new URL('/oauth2/token', config.loginBaseUrl), {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'authorization_code', client_id: config.clientId,
      redirect_uri: config.callbackUrl, code, code_verifier: transaction.verifier})});
  if (!result.ok) throw new Error('No se pudo completar el acceso.');
  const body = await result.json();
  if (body.token_type !== 'Bearer' || typeof body.access_token !== 'string' || typeof body.id_token !== 'string' || typeof body.refresh_token !== 'string' ||
      !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 3600) {
    throw new Error('Respuesta de acceso no válida.');
  }
  session = {accessToken: body.access_token, idToken: body.id_token,
    expiresAt: Date.now() + body.expires_in * 1000};
  sessionStorage.setItem(refreshKey, JSON.stringify({refreshToken:body.refresh_token,
    clientId:config.clientId,callbackUrl:config.callbackUrl,createdAt:Date.now()}));
  if (transaction.returnHash?.startsWith('#/')) window.history.replaceState(null, '', '/' + transaction.returnHash);
  sessionStorage.setItem('mastererp.dev.returning', 'true');
}

export async function restoreSession(config) {
  let saved=null;try{saved=JSON.parse(sessionStorage.getItem(refreshKey)||'null');}catch{}
  if(!saved || typeof saved.refreshToken!=='string' || saved.clientId!==config.clientId || saved.callbackUrl!==config.callbackUrl){clearSession();return false;}
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    const result=await authFetch(config,new URL('/oauth2/token',config.loginBaseUrl),{method:'POST',credentials:'omit',cache:'no-store',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:config.clientId,refresh_token:saved.refreshToken})});
    if(!result.ok){clearSession();return false;}
    const body=await result.json();
    if(body.token_type!=='Bearer'||typeof body.access_token!=='string'||!Number.isFinite(body.expires_in)||body.expires_in<=0||body.expires_in>3600){clearSession();return false;}
    session={accessToken:body.access_token,idToken:typeof body.id_token==='string'?body.id_token:null,expiresAt:Date.now()+body.expires_in*1000};
    if(typeof body.refresh_token==='string'&&body.refresh_token)sessionStorage.setItem(refreshKey,JSON.stringify({...saved,refreshToken:body.refresh_token,rotatedAt:Date.now()}));
    return true;
  })().finally(()=>{refreshing=null;});
  return refreshing;
}

export function clearSession() {
  session = null;
  sessionStorage.removeItem(transactionKey);
  sessionStorage.removeItem(refreshKey);
  sessionStorage.removeItem('mastererp.dev.returning');
  sessionStorage.removeItem('mastererp.dev.selection');
}

export function logout(config) {
  clearSession();
  const url = new URL('/logout', config.loginBaseUrl);
  url.search = new URLSearchParams({client_id: config.clientId, logout_uri: config.logoutUrl}).toString();
  window.location.assign(url.href);
}

export async function loadSpaces(config) {
  if (!session || session.expiresAt <= Date.now()) {
    clearSession();
    throw new Error('Inicia sesión para consultar tus espacios.');
  }
  const result = await fetch(config.apiUrl + '/v1/uonify/spaces', {cache: 'no-store', credentials: 'omit',
    headers: {Authorization: 'Bearer ' + session.accessToken}});
  if (!result.ok) {
    if (result.status === 401) clearSession();
    if (result.status === 403) throw new Error('Tu identidad todavía no tiene acceso asignado en MasterERP.');
    throw new Error('La consulta de espacios todavía no está disponible.');
  }
  const body = await result.json();
  if (!Array.isArray(body.spaces) || body.spaces.some(s => typeof s.id !== 'string' || typeof s.name !== 'string')) {
    throw new Error('No se pudo validar la lista de espacios.');
  }
  return body.spaces;
}


export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function sessionExpiresAt() { return session?.expiresAt || 0; }

export function identityToken() {
  if (!session || session.expiresAt <= Date.now() || !session.idToken) return null;
  return session.idToken;
}

export async function authorizedFetch(url, options = {}) {
  if (!session || session.expiresAt <= Date.now()) {
    clearSession();
    throw new ApiError(401, 'session_expired');
  }
  const response = await fetch(url, {...options, cache:'no-store', credentials:'omit',
    headers:{...options.headers, Authorization:'Bearer ' + session.accessToken}});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearSession();
    throw new ApiError(response.status, body.error?.code || body.error || 'request_failed');
  }
  return body;
}

export async function authorizedIdentityFetch(url, options = {}) {
  if (!session || session.expiresAt <= Date.now() || !session.idToken) {
    clearSession();
    throw new ApiError(401, 'session_expired');
  }
  const response = await fetch(url, {...options, cache:'no-store', credentials:'omit',
    headers:{...options.headers, Authorization:'Bearer ' + session.idToken}});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearSession();
    throw new ApiError(response.status, body.error?.code || body.error || 'request_failed');
  }
  return body;
}
