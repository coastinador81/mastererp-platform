import React, {useEffect, useRef, useState} from 'react';
import CatalogListPage from './CatalogListPage.jsx';
import CatalogEditorPage from './CatalogEditorPage.jsx';
import LoadingState from '../../../../shared/loading-state/LoadingState.jsx';
import Toast from '../../../../shared/toast/Toast.jsx';
import ActionDialog from '../../../../shared/dialog/ActionDialog.jsx';
import {catalogHref, catalogRequest, legacyCatalogRoutes, definitions, exportCsv, payloadFor} from './catalogModel.mjs';
import {financeTaxConfigEvent, loadFinanceConfig, readFinanceConfig} from '../../../../shared/finance-tax-config.mjs';
import {catalogFinancePricingConfig} from './productPricingFinance.mjs';
import './catalog.css';

function locationFor(route) {
  const normalized = window.location.hash.replace(`#/${'modulos/catalogo/' + legacyCatalogRoutes[route]}`, `#/${route}`);
  const [current, id, action] = normalized.replace(/^#\/?/, '').split('/');
  if (current !== route) return {mode: 'list'};
  if (id === 'new' && !action) return {mode: 'new'};
  if (action === 'view') {try {return {mode: 'view', id: decodeURIComponent(id)};} catch {return {mode: 'invalid'};}}
  return {mode: 'list'};
}
async function loadCatalogOptions(runtime, path, signal) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const separator = path.includes('?') ? '&' : '?';
    const data = await catalogRequest(runtime, `${path}${separator}limit=100&offset=${offset}`, {signal});
    if (!Array.isArray(data?.items)) throw new Error('invalid_catalog_options');
    items.push(...data.items);
    if (items.length >= Number(data.total ?? data.items.length) || data.items.length < 100) return items;
  }
}
export default function CatalogPage({runtime, route}) {
  // Context changes unmount all drafts, pending responses and local previews.
  return <CatalogSession key={`${route}:${runtime.api}:${runtime.tenant}:${runtime.company}:${(runtime.permissions || []).join(',')}`} runtime={runtime} route={route}/>;
}
function CatalogSession({runtime, route}) {
  const definition = definitions[route], writable = runtime.permissions?.includes(`catalog.${route}.write`) === true;
  const canCreateAttributes = runtime.permissions?.includes('catalog.attributes.create') === true || runtime.permissions?.includes('catalog.attributes.write') === true;
  const [location, setLocation] = useState(() => locationFor(route));
  const [items, setItems] = useState([]), [total, setTotal] = useState(0), [record, setRecord] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [categoryOptions, setCategoryOptions] = useState([]), [brandOptions, setBrandOptions] = useState([]), [supplierOptions, setSupplierOptions] = useState([]), [attributeOptions, setAttributeOptions] = useState([]), [allAttributeOptions, setAllAttributeOptions] = useState([]);
  const [confirmation, setConfirmation] = useState(null);
  const [financePricingConfig, setFinancePricingConfig] = useState(() => readFinanceConfig(runtime.tenant));
  const [query, setQuery] = useState({search: '', status: '', offset: 0}), [revision, setRevision] = useState(0);
  const alive = useRef(true), lock = useRef(false), idempotency = useRef(null), runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {
    let active = true;
    loadFinanceConfig(runtimeRef.current).then(config => { if (active) setFinancePricingConfig(config); });
    return () => { active = false; };
  }, [runtime.tenant, runtime.company, runtime.api]);
  useEffect(() => {
    const refresh = event => {
      if (event?.detail?.tenant && event.detail.tenant !== runtime.tenant) return;
      setFinancePricingConfig(readFinanceConfig(runtime.tenant));
    };
    window.addEventListener(financeTaxConfigEvent, refresh);
    return () => window.removeEventListener(financeTaxConfigEvent, refresh);
  }, [runtime.tenant]);
  useEffect(() => {const change = () => {setLocation(locationFor(route)); setRecord(null); setError(''); setLoading(true);}; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);}, [route]);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setError(''); setLoading(true);
    if (location.mode === 'new' || location.mode === 'invalid') {setLoading(false); return () => controller.abort();}
    const params = new URLSearchParams({limit: '15', offset: String(query.offset)});
    if (query.search) params.set('search', query.search); if (query.status) params.set('status', query.status);
    const path = location.mode === 'view' ? `${definition.path}/${encodeURIComponent(location.id)}` : `${definition.path}?${params}`;
    catalogRequest(runtimeRef.current, path, {signal: controller.signal}).then(data => {
      if (!active) return;
      if (location.mode === 'view') {if (!data || !data[definition.key]) throw new Error('Registro no disponible.'); setRecord(data);}
      else {if (!Array.isArray(data.items)) throw new Error('Respuesta no válida.'); setItems(data.items); setTotal(Number(data.total ?? data.items.length));}
    }).catch(() => {if (active) {setError('No se pudo cargar la información. Verifica tu acceso o intenta actualizar.'); setItems([]); setTotal(0); setRecord(null);}}).finally(() => {if (active) setLoading(false);});
    return () => {active = false; controller.abort();};
  }, [definition, location, query, revision, route]);
  useEffect(() => {
    if (!['products', 'categories'].includes(route) || location.mode === 'list') return;
    const controller = new AbortController();
    loadCatalogOptions(runtimeRef.current, '/v1/catalog/categories', controller.signal)
      .then(setCategoryOptions)
      .catch(() => {if (!controller.signal.aborted) setNotice('No se pudieron cargar las categorías disponibles.');});
    return () => controller.abort();
  }, [location.mode, route, revision]);
  useEffect(() => {
    if (route !== 'products' || location.mode === 'list') return;
    const controller = new AbortController();
    Promise.allSettled([
      loadCatalogOptions(runtimeRef.current, '/v1/catalog/brands', controller.signal),
      loadCatalogOptions(runtimeRef.current, '/v1/catalog/suppliers', controller.signal),
      loadCatalogOptions(runtimeRef.current, '/v1/catalog/attributes', controller.signal),
    ]).then(([brands, suppliers, attributes]) => {
      if (brands.status === 'fulfilled') setBrandOptions(brands.value.filter(item => item.status === 'ACTIVE'));
      if (suppliers.status === 'fulfilled') setSupplierOptions(suppliers.value.filter(item => item.status === 'ACTIVE'));
      if (attributes.status === 'fulfilled') {setAllAttributeOptions(attributes.value); setAttributeOptions(attributes.value.filter(item => item.status === 'ACTIVE'));}
      if (brands.status === 'rejected' || suppliers.status === 'rejected' || attributes.status === 'rejected') setNotice('Algunas opciones del producto no pudieron cargarse.');
    });
    return () => controller.abort();
  }, [location.mode, route, revision]);
  const refresh = () => setRevision(value => value + 1);
  async function uploadProductImage(productId, file) {
    const ticket = await catalogRequest(runtime, `${definition.path}/${encodeURIComponent(productId)}/images/upload-request`, {method: 'POST', body: JSON.stringify({filename: file.name, content_type: file.type, size: file.size})});
    const form = new FormData(); Object.entries(ticket.upload.fields).forEach(([key, value]) => form.append(key, value)); form.append('file', file);
    const response = await fetch(ticket.upload.url, {method: 'POST', body: form}); if (!response.ok) throw new Error('upload_failed');
    return {id: ticket.id, key: ticket.key, name: ticket.name, url: ticket.url, content_type: ticket.content_type};
  }
  async function createVariantAttribute(preset) {
    if (!canCreateAttributes || busy) return false;
    setBusy(true); setError('');
    try {
      const existing = allAttributeOptions.find(item => item.code === preset.code);
      const attribute = existing?.status === 'INACTIVE'
        ? await catalogRequest(runtime, `/v1/catalog/attributes/${encodeURIComponent(existing.code)}`, {method: 'PATCH', body: JSON.stringify({version: existing.version, status: 'ACTIVE'})})
        : existing || await catalogRequest(runtime, '/v1/catalog/attributes', {method: 'POST', headers: {'Idempotency-Key': crypto.randomUUID()}, body: JSON.stringify({...preset, type: 'SELECT', required: false, sort_order: 0, category_slugs: []})});
      if (!attribute?.code) throw new Error('invalid_attribute_response');
      setAttributeOptions(current => [...current.filter(item => item.code !== attribute.code), attribute]);
      setAllAttributeOptions(current => [...current.filter(item => item.code !== attribute.code), attribute]);
      setNotice(existing ? `Atributo ${attribute.name} disponible. Ya puedes seleccionarlo.` : `Atributo ${attribute.name} creado. Ya puedes seleccionarlo para generar variantes.`);
      return attribute;
    } catch (createError) {
      setError(createError?.status === 403 ? 'No tienes permiso para crear o activar atributos.' : 'No se pudo preparar el atributo. Actualiza la ficha e inténtalo nuevamente.');
      return false;
    } finally { setBusy(false); }
  }
  async function save(draft) {
    if (!writable || lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try {
      const payload = payloadFor(route, {...draft, name: draft.name.trim(), options: draft.options?.map(value => value.trim()).filter(Boolean), category_slugs: draft.category_slugs?.map(value => value.trim()).filter(Boolean)}, record);
      const body = JSON.stringify(payload);
      if (!record && idempotency.current?.body !== body) idempotency.current = {body, key: crypto.randomUUID()};
      const saved = await catalogRequest(runtime, record ? `${definition.path}/${encodeURIComponent(record[definition.key])}` : definition.path, {method: record ? 'PATCH' : 'POST', body, headers: record ? {} : {'Idempotency-Key': idempotency.current.key}});
      if (!alive.current) return false;
      if (!saved?.[definition.key]) throw new Error('Respuesta de guardado incompleta.');
      setNotice(route === 'products'
        ? 'Producto guardado. Para verlo en Storefront debe estar activo y tener existencias disponibles con ventas habilitadas en el nodo de la tienda.'
        : 'Registro guardado correctamente.');
      setRecord(saved); idempotency.current = null;
      if (!record) window.location.hash = catalogHref(route, saved[definition.key]);
      return true;
    } catch {if (alive.current) setError('No se pudo guardar. Revisa los datos y permisos. Si otra persona modificó el registro, vuelve a abrirlo antes de reintentar.'); return false;}
    finally {lock.current = false; if (alive.current) setBusy(false);}
  }
  async function publish(selected) {
    if (!writable || !selected.length || lock.current) return;
    setConfirmation({kind: 'publish', selected});
  }
  async function confirmPublish(selected) {
    setConfirmation(null);
    lock.current = true; setBusy(true); setError(''); let completed = 0;
    try {
      for (const item of selected) {
        if (!alive.current) break;
        if (item.status !== 'ACTIVE') await catalogRequest(runtime, `${definition.path}/${encodeURIComponent(item[definition.key])}`, {method: 'PATCH', body: JSON.stringify({version: item.version, status: 'ACTIVE'})});
        completed++;
      }
      if (alive.current) setNotice(`${completed} registros activos. Se actualizará la lista.`);
    } catch {if (alive.current) setNotice(`Se completaron ${completed} de ${selected.length} registros. La operación se detuvo; revisa permisos o cambios concurrentes antes de reintentar.`);}
    finally {lock.current = false; if (alive.current) {setBusy(false); refresh();}}
  }
  function download(selected) {
    if (!selected.length) return;
    const url = URL.createObjectURL(new Blob([exportCsv(selected, definition)], {type: 'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${route}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exportados ${selected.length} registros seleccionados.`);
  }
  return <section className="catalog-ui" aria-label={definition.title}>
    <Toast message={error} tone="error" onClose={() => setError('')}/><Toast message={!error && notice} tone="success" onClose={() => setNotice('')}/>
    {location.mode === 'list' ? <CatalogListPage {...{definition, route, items, total, loading, busy, writable, refresh, publish, download, error, onPublishRow: item => publish([item]), onDeleteRow: item => setConfirmation({kind: 'delete', item})}} serverOffset={query.offset} searchRemote={(search, status, page = 1) => setQuery({search, status, offset: (page - 1) * 15})}/>
      : loading ? <LoadingState label="Cargando ficha…"/>
      : location.mode === 'invalid' || (location.mode === 'view' && !record) ? <a href={catalogHref(route)}>Volver a {definition.title.toLowerCase()}</a>
      : <CatalogEditorPage
          key={`${location.mode}:${record?.[definition.key] || 'new'}:${record?.version || ''}`}
          {...{definition, route, record, writable, busy, save, categoryOptions, brandOptions, supplierOptions, attributeOptions, uploadProductImage, createVariantAttribute, canCreateAttributes, financePricingConfig: route === 'products' ? catalogFinancePricingConfig(financePricingConfig) : undefined}}
          notify={setNotice}
        />}
    <ActionDialog open={confirmation?.kind === 'publish'} title="Publicar selección" description={`Se activarán ${confirmation?.selected?.length || 0} registros en el catálogo.`} confirmLabel="Publicar" busy={busy} onCancel={() => setConfirmation(null)} onConfirm={() => confirmPublish(confirmation?.selected)}/>
    <ActionDialog open={confirmation?.kind === 'delete'} title="Eliminar producto" description={`${confirmation?.item?.name || 'Este producto'} no se puede eliminar de forma permanente: el catálogo DEV no expone DELETE. Puedes inactivarlo o descontinuarlo desde Editar.`} confirmLabel="Ir a editar" busy={busy} onCancel={() => setConfirmation(null)} onConfirm={() => {const item = confirmation?.item; setConfirmation(null); if (item) window.location.hash = catalogHref(route, item[definition.key]);}}/>
  </section>;
}
