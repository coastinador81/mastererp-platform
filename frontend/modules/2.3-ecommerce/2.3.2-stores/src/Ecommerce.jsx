import React, { useCallback, useEffect, useState } from 'react';
import './style.css';

const call = (runtime, path, options = {}) => runtime.request(runtime.api + path, { ...options, headers: { 'X-Tenant-Id': runtime.tenant, 'Content-Type': 'application/json', ...(options.headers || {}) } });
const destinations = [
  { href: '#/modulos/operaciones/pedidos', eyebrow: 'OPERACIONES', title: 'Pedidos', copy: 'Gestiona compras, estados y entrega.', permission: 'operations.orders.read' },
  { href: '#/modulos/catalogo/productos', eyebrow: 'CATÁLOGO', title: 'Productos', copy: 'Mantén la ficha comercial canónica.', permission: 'catalog.products.read' },
  { href: '#/modulos/catalogo/inventario', eyebrow: 'EXISTENCIAS', title: 'Inventario', copy: 'Consulta disponibilidad por nodo.', permission: 'catalog.inventory.read' },
  { href: '#/modulos/operaciones/preparacion', eyebrow: 'FULFILLMENT', title: 'Preparación', copy: 'Controla líneas y pedidos listos.', permission: 'operations.preparation.read' },
];

export default function Ecommerce({ runtime }) {
  const [items, setItems] = useState([]), [selected, setSelected] = useState(null), [error, setError] = useState('');
  const write = runtime.permissions.includes('digital_sales.ecommerce.write');
  const load = useCallback(async () => { try { const rows = (await call(runtime, `/v1/companies/${runtime.company}/stores`)).items; setItems(rows); setSelected(current => rows.find(store => store.id === current?.id) || null); setError(''); } catch (problem) { setError(problem.message); } }, [runtime]);
  useEffect(() => { if (runtime.company) load(); }, [runtime.company, load]);
  async function save(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const changes = { status: form.get('status'), branding: { primaryColor: form.get('color') }, modules: String(form.get('modules')).split(',').map(value => value.trim()).filter(Boolean) };
    try { await call(runtime, `/v1/companies/${runtime.company}/stores/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ version: selected.version, changes }) }); await load(); } catch (problem) { setError(problem.message); }
  }
  const active = items.filter(store => store.status === 'ACTIVE').length;
  return <section className="canonical-module ecommerce-module">
    <header className="commerce-heading"><div><small>VENTAS DIGITALES · E-COMMERCE</small><h1>Centro de comercio</h1><p>Controla tus tiendas y abre las capacidades que sostienen la venta online.</p></div><button className="commerce-refresh" onClick={load}>Actualizar</button></header>
    <div className="commerce-metrics"><article><span>Tiendas</span><strong>{items.length}</strong><small>configuradas</small></article><article><span>Activas</span><strong>{active}</strong><small>recibiendo tráfico</small></article><article><span>En pausa</span><strong>{items.filter(store => store.status === 'PAUSED').length}</strong><small>sin operación comercial</small></article></div>
    <div className="commerce-links">{destinations.filter(item => runtime.permissions.includes(item.permission)).map(item => <a key={item.href} href={item.href}><small>{item.eyebrow}</small><h2>{item.title}</h2><p>{item.copy}</p><strong>Abrir →</strong></a>)}</div>
    {error ? <p className="commerce-error" role="alert">{error}</p> : null}
    <div className="store-layout"><div className="store-list"><div className="store-list-heading"><h2>Tiendas</h2><span>{items.length} registradas</span></div>{items.map(store => <button className={`store-card ${selected?.id === store.id ? 'selected' : ''}`} key={store.id} onClick={() => setSelected(store)}><i style={{ background: store.branding?.primaryColor || '#096bdc' }}>{store.name.slice(0, 1).toUpperCase()}</i><span><strong>{store.name}</strong><small>{store.domain}</small></span><b className={store.status.toLowerCase()}>{store.status}</b></button>)}{!items.length ? <p className="store-empty">No hay tiendas configuradas.</p> : null}</div>
      <aside className="store-detail">{selected ? <><div className="store-title"><div><small>CONFIGURACIÓN</small><h2>{selected.name}</h2><p>{selected.domain} · nodo {selected.node_id}</p></div><a href={`https://${selected.domain}`} target="_blank" rel="noreferrer">Ver tienda ↗</a></div>{write ? <form onSubmit={save}><div className="store-form-grid"><label>Estado<select name="status" defaultValue={selected.status}><option>DRAFT</option><option>ACTIVE</option><option>PAUSED</option></select></label><label>Color principal<input name="color" type="color" defaultValue={selected.branding?.primaryColor || '#096bdc'} /></label></div><label>Módulos opcionales<input name="modules" defaultValue={(selected.modules || []).join(',')} /><small>Separados por coma; las APIs vuelven a validar permisos.</small></label><button className="store-save">Guardar configuración</button></form> : <p>Acceso de solo lectura.</p>}</> : <div className="store-empty"><strong>Selecciona una tienda</strong><p>Consulta dominio, nodo, estado y configuración visual.</p></div>}</aside>
    </div>
  </section>;
}
