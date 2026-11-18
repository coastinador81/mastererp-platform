import {
  ApiError,
  authorizedFetch,
  completeLogin,
  loadSpaces,
  login,
  logout,
  restoreSession,
} from '../../../shared/auth/cognito.mjs';

const API_URL = (import.meta.env.VITE_INVENTORY_API_URL || '').replace(/\/$/, '');
const RETURN_KEY = 'mastererp.inventory.return';
const SELECTION_KEY = 'mastererp.inventory.selection';

function authConfig() {
  return {
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
    loginBaseUrl: import.meta.env.VITE_COGNITO_LOGIN_URL || '',
    callbackUrl: `${window.location.origin}/`,
    logoutUrl: `${window.location.origin}/`,
    apiUrl: API_URL,
    scopes: ['openid', 'email', 'mastererp-dev/identity.spaces.read'],
  };
}

function restoreInventoryReturn() {
  const target = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  if (target?.startsWith('/') && !target.startsWith('//')) {
    window.history.replaceState(null, '', target);
  }
}

function saveSelection(tenantId, companyId = '') {
  sessionStorage.setItem(SELECTION_KEY, JSON.stringify({ tenantId, companyId }));
}

function savedSelection() {
  try {
    return JSON.parse(sessionStorage.getItem(SELECTION_KEY) || '{}');
  } catch {
    sessionStorage.removeItem(SELECTION_KEY);
    return {};
  }
}

async function tenantContext(tenantId, signal) {
  const query = new URLSearchParams({ tenant_id: tenantId });
  const response = await authorizedFetch(`${API_URL}/v1/uonify/spaces?${query}`, { signal });
  const context = response.context;
  if (context?.tenant_id !== tenantId || !Array.isArray(context.companies)) {
    throw new Error('No se pudo validar el espacio y sus empresas.');
  }
  return context;
}

export async function beginInventoryLogin() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  sessionStorage.setItem(RETURN_KEY, returnTo.startsWith('/') ? returnTo : '/');
  await login(authConfig());
}

export async function startInventorySession() {
  const config = authConfig();
  const query = new URLSearchParams(window.location.search);
  if (query.has('code') || query.has('error')) {
    await completeLogin(config, window.location.href);
    restoreInventoryReturn();
  } else if (!(await restoreSession(config))) {
    return { status: 'signed-out', spaces: [], tenantId: '', context: null, companyId: '' };
  }

  const spaces = await loadSpaces(config);
  const selection = savedSelection();
  const tenantId = spaces.some(space => space.id === selection.tenantId)
    ? selection.tenantId
    : spaces.length === 1 ? spaces[0].id : '';
  const context = tenantId ? await tenantContext(tenantId) : null;
  const companyId = context?.companies.some(company => company.id === selection.companyId)
    ? selection.companyId
    : context?.companies.length === 1 ? context.companies[0].id : '';
  if (tenantId) saveSelection(tenantId, companyId);
  return { status: 'signed-in', spaces, tenantId, context, companyId };
}

export async function selectInventoryTenant(spaces, tenantId) {
  if (!spaces.some(space => space.id === tenantId)) throw new Error('Selecciona un espacio disponible.');
  const context = await tenantContext(tenantId);
  const companyId = context.companies.length === 1 ? context.companies[0].id : '';
  saveSelection(tenantId, companyId);
  return { tenantId, context, companyId };
}

export function selectInventoryCompany(context, tenantId, companyId) {
  if (!context?.companies.some(company => company.id === companyId)) {
    throw new Error('Selecciona una empresa disponible.');
  }
  saveSelection(tenantId, companyId);
}

export function endInventorySession() {
  sessionStorage.removeItem(SELECTION_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  logout(authConfig());
}

function purchasePath(companyId, purchaseOrderId = '') {
  const base = `${API_URL}/v1/companies/${encodeURIComponent(companyId)}/inventory/receipts/orders`;
  return purchaseOrderId ? `${base}/${encodeURIComponent(purchaseOrderId)}` : base;
}

export async function loadPurchaseOrders(tenantId, companyId, signal) {
  const items = [];
  let after = '';
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (after) query.set('after', after);
    const response = await authorizedFetch(`${purchasePath(companyId)}?${query}`, {
      signal,
      headers: { 'X-Tenant-Id': tenantId },
    });
    if (!Array.isArray(response.items)) throw new Error('La respuesta de órdenes no tiene el formato esperado.');
    items.push(...response.items);
    after = response.next_cursor || '';
    if (items.length >= 2000 && after) {
      throw new Error('La consulta supera 2.000 órdenes. Reduce el volumen antes de continuar.');
    }
  } while (after);
  return items;
}

export async function loadPurchaseOrder(tenantId, companyId, orderId, signal) {
  const response = await authorizedFetch(purchasePath(companyId, orderId), {
    signal,
    headers: { 'X-Tenant-Id': tenantId },
  });
  if (!response.item) throw new Error('No se pudo cargar el detalle de la orden.');
  return response.item;
}

export function sessionErrorMessage(error) {
  if (error instanceof ApiError && error.status === 401) return 'La sesión venció. Inicia sesión nuevamente.';
  if (error instanceof ApiError && error.status === 403) return 'Tu usuario no tiene permiso de lectura de Compras para esta empresa.';
  return error?.message || 'No se pudieron consultar las órdenes de compra.';
}
