import React, {useEffect, useRef, useState} from 'react';
import CatalogListPage from './CatalogListPage.jsx';
import CatalogEditorPage from './CatalogEditorPage.jsx';
import LoadingState from '../../../../shared/loading-state/LoadingState.jsx';
import Toast from '../../../../shared/toast/Toast.jsx';
import ActionDialog from '../../../../shared/dialog/ActionDialog.jsx';
import {catalogHref, catalogRequest, legacyCatalogRoutes, definitions, exportCsv, payloadFor} from './catalogModel.mjs';
import './catalog.css';

function locationFor(route) {
  const normalized = window.location.hash.replace(`#/${'modulos/catalogo/' + legacyCatalogRoutes[route]}`, `#/${route}`);
  const [current, id, action] = normalized.replace(/^#\/?/, '').split('/');
  if (current !== route) return {mode: 'list'};
  if (id === 'new' && !action) return {mode: 'new'};
  if (action === 'view') {try {return {mode: 'view', id: decodeURIComponent(id)};} catch {return {mode: 'invalid'};}}
  return {mode: 'list'};
}
export default function CatalogPage({runtime, route}) {
  // Context changes unmount all drafts, pending responses and local previews.
  return <CatalogSession key={`${route}:${runtime.api}:${runtime.tenant}:${runtime.company}:${(runtime.permissions || []).join(',')}`} runtime={runtime} route={route}/>;
}
function CatalogSession({runtime, route}) {
  const definition = definitions[route], writable = runtime.permissions?.includes(`catalog.${route}.write`) === true;
  const [location, setLocation] = useState(() => locationFor(route));
  const [items, setItems] = useState([]), [record, setRecord] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [confirmation, setConfirmation] = useState(null);
  const [query, setQuery] = useState({search: '', status: ''}), [revision, setRevision] = useState(0);
  const alive = useRef(true), lock = useRef(false), idempotency = useRef(null), runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {const change = () => {setLocation(locationFor(route)); setRecord(null); setError(''); setLoading(true);}; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);}, [route]);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setError(''); setLoading(true);
    if (location.mode === 'new' || location.mode === 'invalid') {setLoading(false); return () => controller.abort();}
    const params = new URLSearchParams({limit: '100'});
    if (route === 'products') {if (query.search) params.set('search', query.search); if (query.status) params.set('status', query.status);}
    const path = location.mode === 'view' ? `${definition.path}/${encodeURIComponent(location.id)}` : `${definition.path}?${params}`;
    catalogRequest(runtimeRef.current, path, {signal: controller.signal}).then(data => {
      if (!active) return;
      if (location.mode === 'view') {if (!data || !data[definition.key]) throw new Error('Registro no disponible.'); setRecord(data);}
      else {if (!Array.isArray(data.items)) throw new Error('Respuesta no válida.'); setItems(data.items);}
    }).catch(() => {if (active) {setError('No se pudo cargar la información. Verifica tu acceso o intenta actualizar.'); setItems([]); setRecord(null);}}).finally(() => {if (active) setLoading(false);});
    return () => {active = false; controller.abort();};
  }, [definition, location, query, revision, route]);
  useEffect(() => {
    if (!['products', 'categories'].includes(route) || location.mode === 'list') return;
    const controller = new AbortController();
    catalogRequest(runtimeRef.current, '/v1/catalog/categories?limit=100', {signal: controller.signal})
      .then(data => {if (Array.isArray(data?.items)) setCategoryOptions(data.items);})
      .catch(() => {if (!controller.signal.aborted) setNotice('No se pudieron cargar las categorías disponibles.');});
    return () => controller.abort();
  }, [location.mode, route, revision]);
  const refresh = () => setRevision(value => value + 1);
  async function uploadProductImage(productId, file) {
    const ticket = await catalogRequest(runtime, `${definition.path}/${encodeURIComponent(productId)}/images/upload-request`, {method: 'POST', body: JSON.stringify({filename: file.name, content_type: file.type, size: file.size})});
    const form = new FormData(); Object.entries(ticket.upload.fields).forEach(([key, value]) => form.append(key, value)); form.append('file', file);
    const response = await fetch(ticket.upload.url, {method: 'POST', body: form}); if (!response.ok) throw new Error('upload_failed');
    return {id: ticket.id, key: ticket.key, name: ticket.name, url: ticket.url, content_type: ticket.content_type};
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
      setNotice('Registro guardado. Las vistas previas locales no se envían al catálogo.');
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
    {location.mode === 'list' ? <CatalogListPage {...{definition, route, items, loading, busy, writable, refresh, publish, download, error}} searchRemote={route === 'products' ? (search, status) => setQuery({search, status}) : null}/>
      : loading ? <LoadingState label="Cargando ficha…"/>
      : location.mode === 'invalid' || (location.mode === 'view' && !record) ? <a href={catalogHref(route)}>Volver a {definition.title.toLowerCase()}</a>
      : <CatalogEditorPage key={`${location.mode}:${record?.[definition.key] || 'new'}:${record?.version || ''}`} {...{definition, route, record, writable, busy, save, categoryOptions, uploadProductImage}} notify={setNotice}/>}
    <ActionDialog open={confirmation?.kind === 'publish'} title="Publicar selección" description={`Se activarán ${confirmation?.selected?.length || 0} registros en el catálogo.`} confirmLabel="Publicar" busy={busy} onCancel={() => setConfirmation(null)} onConfirm={() => confirmPublish(confirmation.selected)}/>
  </section>;
}
