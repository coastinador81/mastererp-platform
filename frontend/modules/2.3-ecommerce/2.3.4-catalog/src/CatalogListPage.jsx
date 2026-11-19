import React, {useEffect, useRef, useState} from 'react';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import StatusBadge from '../../../../shared/status-badge/StatusBadge.jsx';
import LoadingState from '../../../../shared/loading-state/LoadingState.jsx';
import {catalogHref, cellText, filterRecords, statusLabels} from './catalogModel.mjs';

export function CatalogStatusBadge({status}) {
  return <StatusBadge status={status} tone={status === 'ACTIVE' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral'}>{statusLabels[status] || status || 'Sin estado'}</StatusBadge>;
}
export function CatalogEmptyState({filtered}) {
  return <div className="cat-empty"><FinanceIcon name="order"/><h2>{filtered ? 'No hay coincidencias' : 'Todavía no hay registros'}</h2><p>{filtered ? 'Prueba otro nombre, referencia o estado.' : 'Crea el primer registro para organizar tu catálogo.'}</p></div>;
}
export function CatalogToolbar({definition, route, query, status, onQuery, onStatus, refresh, busy, searchRemote}) {
  return <div className="cat-toolbar"><label className="cat-search"><FinanceIcon name="search"/><input type="search" aria-label={`Buscar ${definition.title.toLowerCase()} en registros cargados`} placeholder="Buscar por nombre o referencia…" value={query} onChange={e => onQuery(e.target.value)}/></label>
    {route === 'products' && <>
      <select aria-label="Filtrar por proveedor" defaultValue=""><option value="">Todos los proveedores</option></select>
      <select aria-label="Filtrar por categoría" defaultValue=""><option value="">Todas las categorías</option></select>
    </>}
    <select aria-label="Filtrar por estado" value={status} onChange={e => onStatus(e.target.value)}><option value="">Todos los estados</option>{definition.statuses.map(value => <option value={value} key={value}>{statusLabels[value]}</option>)}</select>
    {searchRemote && route !== 'products' && <button type="button" disabled={busy} onClick={searchRemote}>Buscar en catálogo</button>}<button type="button" disabled={busy} onClick={refresh}>{busy ? 'Actualizando…' : 'Actualizar'}</button></div>;
}
export function CatalogBulkActions({count, writable, busy, publish, download, clear}) {
  return <div className="cat-bulk"><span>{count} seleccionados</span>{writable && <button disabled={!count || busy} onClick={publish}>Publicar selección</button>}<button disabled={!count || busy} onClick={download}>Exportar selección</button><button disabled={!count || busy} onClick={clear}>Limpiar selección</button></div>;
}
function CatalogRowActions({item, href, writable, busy, onPublish, onDelete}) {
  const canPublish = writable && item.status !== 'ACTIVE';
  const label = item.name || 'producto';
  return <td className="cat-row-actions" onClick={e => e.stopPropagation()}>
    <div className="cat-action-group" role="group" aria-label={`Acciones de ${label}`}>
      <a className="cat-action-btn" href={href} title={`Editar ${label}`} aria-label={`Editar ${label}`}><FinanceIcon name="edit"/></a>
      {canPublish && <button type="button" className="cat-action-btn publish" disabled={busy} title={`Publicar ${label}`} aria-label={`Publicar ${label}`} onClick={() => onPublish(item)}><FinanceIcon name="check"/></button>}
      <button type="button" className="cat-action-btn danger" disabled={busy || !writable} title={`Eliminar ${label}`} aria-label={`Eliminar ${label}`} onClick={() => onDelete(item)}><FinanceIcon name="trash"/></button>
    </div>
  </td>;
}
function ProductThumbnail({item, icon}) {
  const [failed, setFailed] = useState(false);
  const image = item.image_url || item.attributes?._media?.images?.find(entry => entry.cover)?.url || item.attributes?._media?.images?.[0]?.url;
  useEffect(() => setFailed(false), [image]);
  return <span className={`cat-icon cat-product-thumbnail ${image && !failed ? 'has-image' : ''}`}>{image && !failed ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)}/> : <FinanceIcon name={icon}/>}</span>;
}
export function CatalogTable({definition, route, rows, selection, setSelection, busy, rowOffset = 0, writable = false, onPublishRow, onDeleteRow}) {
  const checkbox = useRef(null);
  const numbered = route === 'products';
  const actionColumn = route === 'products' && Boolean(onPublishRow && onDeleteRow);
  const all = rows.length > 0 && rows.every(item => selection.has(item[definition.key]));
  useEffect(() => {if (checkbox.current) checkbox.current.indeterminate = !all && rows.some(item => selection.has(item[definition.key]));}, [all, rows, selection, definition]);
  const toggle = (key, checked) => setSelection(current => {const next = new Set(current); checked ? next.add(key) : next.delete(key); return next;});
  return <div className="cat-table-scroll" role="region" aria-label={`Tabla de ${definition.title.toLowerCase()}`} tabIndex={0}><table className="cat-table"><thead><tr><th><input ref={checkbox} type="checkbox" aria-label="Seleccionar esta página" checked={all} disabled={busy || !rows.length} onChange={e => {const checked = e.target.checked; setSelection(current => {const next = new Set(current); rows.forEach(item => checked ? next.add(item[definition.key]) : next.delete(item[definition.key])); return next;});}}/></th>{numbered && <th className="cat-row-number" scope="col">Nº</th>}<th>{route === 'products' ? 'Producto' : 'Nombre'}</th><th>Referencia</th>{definition.columns.map(([key, label]) => <th key={key}>{label}</th>)}<th>Estado</th>{actionColumn && <th>Acciones</th>}</tr></thead>
    <tbody>{rows.map((item, index) => {const id = item[definition.key], href = catalogHref(route, id); return <tr key={id} onClick={e => {if (busy || e.target.closest('a,button,input,select,.cat-row-actions') || e.ctrlKey || e.metaKey || e.shiftKey || window.getSelection()?.toString()) return; window.location.hash = href;}}>
      <td><input type="checkbox" aria-label={`Seleccionar ${item.name}`} checked={selection.has(id)} disabled={busy} onChange={e => toggle(id, e.target.checked)}/></td>
      {numbered && <td className="cat-row-number">{rowOffset + index + 1}</td>}
      <td><div className="cat-name">{route === 'products' ? <ProductThumbnail item={item} icon={definition.icon}/> : <span className="cat-icon"><FinanceIcon name={definition.icon}/></span>}<a href={href}>{item.name}</a></div></td><td>{item[definition.reference] || '—'}</td>{definition.columns.map(([field]) => <td key={field}>{cellText(item, field)}</td>)}<td><CatalogStatusBadge status={item.status}/></td>{actionColumn && <CatalogRowActions item={item} href={href} writable={writable} busy={busy} onPublish={onPublishRow} onDelete={onDeleteRow}/>}</tr>;})}</tbody></table></div>;
}
export default function CatalogListPage({definition, route, items, total = items.length, loading, busy, writable, refresh, publish, download, searchRemote, serverOffset = 0, error, onPublishRow, onDeleteRow}) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1), [selection, setSelection] = useState(new Set());
  useEffect(() => {setSelection(new Set()); setPage(Math.floor(serverOffset / 15) + 1);}, [items, serverOffset]);
  const filtered = searchRemote ? items : filterRecords(items, query, status, definition), pages = Math.max(1, Math.ceil((searchRemote ? total : filtered.length) / 15)), current = Math.min(page, pages);
  const rows = searchRemote ? filtered : filtered.slice((current - 1) * 15, current * 15);
  const rowOffset = route === 'products' ? (searchRemote ? serverOffset : (current - 1) * 15) : 0;
  const selected = items.filter(item => selection.has(item[definition.key]));
  return <><div className="cat-heading"><div><nav aria-label="Ruta de navegación">E-commerce / Catálogo</nav><h1>{definition.title}</h1><p>{definition.description}</p></div>{writable && <a className="cat-primary" href={catalogHref(route, null, 'new')}><FinanceIcon name="plus"/>Nuevo {definition.singular}</a>}</div>
    <div className="cat-metrics">{[[loading ? '—' : total, 'Registros encontrados', definition.icon], [loading ? '—' : items.filter(item => item.status === 'ACTIVE').length, 'Activos en esta página', 'check'], [loading ? '—' : definition.statuses.includes('DRAFT') ? items.filter(item => item.status === 'DRAFT').length : 'No aplica', 'Borradores en esta página', 'document']].map(([value, label, icon]) => <div key={label}><span className="cat-icon"><FinanceIcon name={icon}/></span><div><strong>{value}</strong><small>{label}</small></div></div>)}</div>
    <section className="cat-surface" aria-busy={loading}><CatalogToolbar definition={definition} route={route} query={query} status={status} onQuery={value => {setQuery(value); setPage(1); setSelection(new Set()); if (searchRemote && route === 'products') searchRemote(value, status, 1);}} onStatus={value => {setStatus(value); setPage(1); setSelection(new Set()); if (searchRemote && route === 'products') searchRemote(query, value, 1);}} refresh={refresh} busy={busy || loading} searchRemote={searchRemote && route !== 'products' ? () => searchRemote(query, status) : null}/>
      <CatalogBulkActions count={selected.length} writable={writable} busy={busy || loading} publish={() => publish(selected)} download={() => download(selected)} clear={() => setSelection(new Set())}/>
      {loading ? <LoadingState label={`Cargando ${definition.title.toLowerCase()}…`}/> : !error && <><CatalogTable {...{definition, route, rows, selection, setSelection, busy, rowOffset, writable, onPublishRow, onDeleteRow}}/>{!filtered.length && <CatalogEmptyState filtered={Boolean(query || status)}/>}</>}
      <footer className="cat-pagination"><span>{searchRemote ? total : filtered.length} resultados · Página {current} de {pages}</span><div><button disabled={current === 1 || loading} onClick={() => {setPage(current - 1); searchRemote?.(query, status, current - 1);}}>Anterior</button><button disabled={current === pages || loading} onClick={() => {setPage(current + 1); searchRemote?.(query, status, current + 1);}}>Siguiente</button></div></footer>
    </section></>;
}
