export const statusLabels = {ACTIVE: 'Activo', INACTIVE: 'Inactivo', DRAFT: 'Borrador', DISCONTINUED: 'Descontinuado', BLOCKED: 'Bloqueado'};
const common = {statuses: ['ACTIVE', 'INACTIVE']};
export const legacyCatalogRoutes = {products: 'productos', categories: 'categorias', attributes: 'atributos', brands: 'marcas', suppliers: 'proveedores'};
export function catalogHref(route, id, mode = 'view', hash = globalThis.location?.hash || '') {
  const base = hash.startsWith('#/modulos/catalogo/') ? `/modulos/catalogo/${legacyCatalogRoutes[route]}` : `/${route}`;
  return '#' + base + (mode === 'new' ? '/new' : id == null ? '' : `/${encodeURIComponent(id)}/view`);
}
export const definitions = {
  products: {...common, title: 'Productos', singular: 'producto', key: 'id', reference: 'code', path: '/v1/products', icon: 'order', description: 'Gestiona la ficha comercial, el precio y la clasificación de tus productos.', statuses: ['ACTIVE', 'INACTIVE', 'DRAFT', 'DISCONTINUED'], fields: ['name', 'description', 'price', 'category_ref', 'brand_ref', 'suppliers', 'image_url', 'attributes'], columns: [['category_ref', 'Categoría'], ['price', 'Precio']]},
  categories: {...common, title: 'Categorías', singular: 'categoría', key: 'slug', reference: 'slug', path: '/v1/catalog/categories', icon: 'order', description: 'Organiza la navegación y clasificación del catálogo.', fields: ['name', 'description', 'parent_slug', 'sort_order', 'image_url'], columns: [['parent_slug', 'Categoría padre'], ['product_count', 'Productos']]},
  attributes: {...common, title: 'Atributos', singular: 'atributo', key: 'code', reference: 'code', path: '/v1/catalog/attributes', icon: 'quote', description: 'Define características y valores reutilizables para tus productos.', fields: ['name', 'required', 'options', 'unit', 'sort_order', 'category_slugs'], columns: [['options', 'Valores']]},
  brands: {...common, title: 'Marcas', singular: 'marca', key: 'slug', reference: 'slug', path: '/v1/catalog/brands', icon: 'sales', description: 'Administra la identidad comercial de las marcas de tu catálogo.', fields: ['name', 'description', 'logo_url', 'website_url'], columns: [['product_count', 'Productos']]},
  suppliers: {...common, title: 'Proveedores', singular: 'proveedor', key: 'id', reference: 'code', path: '/v1/catalog/suppliers', icon: 'supplier', description: 'Mantén actualizados los contactos y las condiciones de suministro.', statuses: ['ACTIVE', 'INACTIVE', 'BLOCKED'], fields: ['name', 'contact', 'terms'], columns: [['terms', 'Condiciones comerciales']]},
};
export function payloadFor(route, draft, record) {
  const definition = definitions[route];
  const payload = Object.fromEntries(definition.fields.filter(key => draft[key] !== undefined).map(key => [key, draft[key]]));
  for (const key of ['parent_slug', 'category_ref', 'brand_ref', 'image_url', 'logo_url', 'website_url', 'unit']) {
    if (key in payload && payload[key] === '') payload[key] = null;
  }
  if (record) return {...payload, status: draft.status, version: record.version};
  if (route === 'products') payload.status = draft.status;
  else payload[definition.reference] = draft[definition.reference];
  if (route === 'attributes') payload.type = draft.type;
  return payload;
}
export function generateProductVariants(selectedCodes, definitions, existing = []) {
  const selected = selectedCodes.map(code => definitions.find(item => item.code === code)).filter(Boolean);
  if (!selected.length) return [];
  if (selected.some(item => !Array.isArray(item.options) || !item.options.filter(Boolean).length)) throw new Error('missing_values');
  const combinations = selected.reduce((rows, attribute) => rows.flatMap(row => attribute.options.filter(Boolean).map(value => ({...row, [attribute.code]: value}))), [{}]);
  if (combinations.length > 200) throw new Error('too_many_variants');
  return combinations.map(values => {
    const key = selected.map(item => `${item.code}:${values[item.code]}`).join('|');
    const previous = existing.find(item => item.key === key);
    return previous ? {...previous, values, key} : {key, values, sku: '', price_delta: 0, active: true};
  });
}
export function filterRecords(items, query, status, definition) {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(item => (!status || item.status === status) && `${item.name} ${item[definition.reference] || ''}`.toLocaleLowerCase().includes(term));
}
export function cellText(record, field) {
  const value = record[field];
  if (field === 'parent_slug') return value || 'Principal';
  if (field === 'options') return Array.isArray(value) ? String(value.length) : '—';
  if (field === 'terms') return value?.payment_days == null ? 'Sin plazo registrado' : `${value.payment_days} días de pago`;
  if (field === 'price') return value == null ? 'Sin precio' : Number(value).toLocaleString('es', {minimumFractionDigits: 2, maximumFractionDigits: 6});
  return value == null || value === '' ? '—' : String(value);
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(items, definition) {
  const columns = [['name', 'Nombre'], [definition.reference, 'Referencia'], ...definition.columns, ['status', 'Estado']];
  return '\uFEFF' + [columns.map(([, label]) => csvCell(label)).join(','), ...items.map(item => columns.map(([field]) => csvCell(field === 'status' ? statusLabels[item.status] || item.status : cellText(item, field))).join(','))].join('\r\n');
}
export async function catalogRequest(runtime, path, options = {}) {
  if (!runtime.api || !runtime.tenant) throw new Error('Selecciona un espacio de trabajo.');
  const headers = {'X-Tenant-Id': runtime.tenant, 'Content-Type': 'application/json', ...options.headers};
  if (runtime.request) return runtime.request(runtime.api + path, {...options, headers});
  const token = await window.mastererpAuth?.getAccessToken?.();
  if (!token) throw new Error('Inicia sesión para continuar.');
  const response = await fetch(runtime.api + path, {...options, headers: {...headers, Authorization: `Bearer ${token}`}});
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 409 ? 'Este registro cambió. Actualiza antes de guardar de nuevo.' : 'No se pudo completar la operación. Comprueba tus permisos e intenta de nuevo.');
  return body;
}
