import React, {useEffect, useRef, useState} from 'react';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import StatusBadge from '../../../../shared/status-badge/StatusBadge.jsx';
import {catalogHref, cellText, filterRecords, statusLabels} from './catalogModel.mjs';

export function CatalogStatusBadge({status}) {
  return <StatusBadge status={status} tone={status === 'ACTIVE' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral'}>{statusLabels[status] || status || 'Sin estado'}</StatusBadge>;
}
export function CatalogEmptyState({filtered}) {
  return <div className="cat-empty"><FinanceIcon name="order"/><h2>{filtered ? 'No hay coincidencias' : 'Todavía no hay registros'}</h2><p>{filtered ? 'Prueba otro nombre, referencia o estado.' : 'Crea el primer registro para organizar tu catálogo.'}</p></div>;
}
export function CatalogToolbar({definition, query, status, onQuery, onStatus, refresh, busy, searchRemote}) {
  return <div className="cat-toolbar"><label className="cat-search"><FinanceIcon name="search"/><input type="search" aria-label={`Buscar ${definition.title.toLowerCase()} en registros cargados`} placeholder="Buscar por nombre o referencia…" value={query} onChange={e => onQuery(e.target.value)}/></label>
    <select aria-label="Filtrar por estado" value={status} onChange={e => onStatus(e.target.value)}><option value="">Todos los estados</option>{definition.statuses.map(value => <option value={value} key={value}>{statusLabels[value]}</option>)}</select>
    {searchRemote && <button type="button" disabled={busy} onClick={searchRemote}>Buscar en catálogo</button>}<button type="button" disabled={busy} onClick={refresh}>{busy ? 'Actualizando…' : 'Actualizar'}</button></div>;
}
export function CatalogBulkActions({count, writable, busy, publish, download, clear}) {
  return <div className="cat-bulk"><span>{count} seleccionados</span>{writable && <button disabled={!count || busy} onClick={publish}>Publicar selección</button>}<button disabled={!count || busy} onClick={download}>Exportar selección</button><button disabled={!count || busy} onClick={clear}>Limpiar selección</button></div>;
}
export function CatalogTable({definition, route, rows, selection, setSelection, busy}) {
  const checkbox = useRef(null);
  const all = rows.length > 0 && rows.every(item => selection.has(item[definition.key]));
  useEffect(() => {if (checkbox.current) checkbox.current.indeterminate = !all && rows.some(item => selection.has(item[definition.key]));}, [all, rows, selection, definition]);
  const toggle = (key, checked) => setSelection(current => {const next = new Set(current); checked ? next.add(key) : next.delete(key); return next;});
  return <div className="cat-table-scroll" role="region" aria-label={`Tabla de ${definition.title.toLowerCase()}`} tabIndex={0}><table className="cat-table"><thead><tr><th><input ref={checkbox} type="checkbox" aria-label="Seleccionar esta página" checked={all} disabled={busy || !rows.length} onChange={e => {const checked = e.target.checked; setSelection(current => {const next = new Set(current); rows.forEach(item => checked ? next.add(item[definition.key]) : next.delete(item[definition.key])); return next;});}}/></th><th>{route === 'products' ? 'Producto' : 'Nombre'}</th><th>Referencia</th>{definition.columns.map(([key, label]) => <th key={key}>{label}</th>)}<th>Estado</th><th>Acción</th></tr></thead>
    <tbody>{rows.map(item => {const id = item[definition.key], href = catalogHref(route, id); return <tr key={id} onClick={e => {if (busy || e.target.closest('a,button,input,select') || e.ctrlKey || e.metaKey || e.shiftKey || window.getSelection()?.toString()) return; window.location.hash = href;}}>
      <td><input type="checkbox" aria-label={`Seleccionar ${item.name}`} checked={selection.has(id)} disabled={busy} onChange={e => toggle(id, e.target.checked)}/></td>
      <td><div className="cat-name"><span className="cat-icon"><FinanceIcon name={definition.icon}/></span><a href={href}>{item.name}</a></div></td><td>{item[definition.reference] || '—'}</td>{definition.columns.map(([field]) => <td key={field}>{cellText(item, field)}</td>)}<td><CatalogStatusBadge status={item.status}/></td><td><a className="cat-detail-link" href={href}>Ver detalle</a></td></tr>;})}</tbody></table></div>;
}
export default function CatalogListPage({definition, route, items, loading, busy, writable, refresh, publish, download, searchRemote, error}) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1), [selection, setSelection] = useState(new Set());
  useEffect(() => {setSelection(new Set()); setPage(1);}, [items]);
  const filtered = filterRecords(items, query, status, definition), pages = Math.max(1, Math.ceil(filtered.length / 15)), current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * 15, current * 15);
  const selected = items.filter(item => selection.has(item[definition.key]));
  return <><div className="cat-heading"><div><nav aria-label="Ruta de navegación">E-commerce / Catálogo</nav><h1>{definition.title}</h1><p>{definition.description}</p></div>{writable && <a className="cat-primary" href={catalogHref(route, null, 'new')}><FinanceIcon name="plus"/>Nuevo {definition.singular}</a>}</div>
    <div className="cat-metrics">{[[loading ? '—' : items.length, 'Registros cargados', definition.icon], [loading ? '—' : items.filter(item => item.status === 'ACTIVE').length, 'Activos', 'check'], [loading ? '—' : definition.statuses.includes('DRAFT') ? items.filter(item => item.status === 'DRAFT').length : 'No aplica', 'Borradores', 'document']].map(([value, label, icon]) => <div key={label}><span className="cat-icon"><FinanceIcon name={icon}/></span><div><strong>{value}</strong><small>{label}</small></div></div>)}</div>
    <section className="cat-surface" aria-busy={loading}><CatalogToolbar definition={definition} query={query} status={status} onQuery={value => {setQuery(value); setPage(1); setSelection(new Set());}} onStatus={value => {setStatus(value); setPage(1); setSelection(new Set());}} refresh={refresh} busy={busy || loading} searchRemote={searchRemote ? () => searchRemote(query, status) : null}/>
      <p className="cat-scope">Búsqueda, indicadores y páginas sobre los registros cargados (máximo 100).{route === 'products' ? ' Usa «Buscar en catálogo» para consultar otros productos.' : ' La consulta no ofrece paginación adicional.'}</p>
      <CatalogBulkActions count={selected.length} writable={writable} busy={busy || loading} publish={() => publish(selected)} download={() => download(selected)} clear={() => setSelection(new Set())}/>
      {loading ? <p className="cat-empty" role="status">Cargando catálogo…</p> : !error && <><CatalogTable {...{definition, route, rows, selection, setSelection, busy}}/>{!filtered.length && <CatalogEmptyState filtered={Boolean(query || status)}/>}</>}
      <footer className="cat-pagination"><span>{filtered.length} resultados · Página {current} de {pages}</span><div><button disabled={current === 1 || loading} onClick={() => setPage(current - 1)}>Anterior</button><button disabled={current === pages || loading} onClick={() => setPage(current + 1)}>Siguiente</button></div></footer>
    </section></>;
}
