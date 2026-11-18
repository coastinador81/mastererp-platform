import React, {useCallback, useEffect, useState} from "react";
import "./style.css";
import {detailFromHash} from "../../../../app-shell/src/detailRoutes.mjs";
import LoadingState from "../../../../shared/loading-state/LoadingState.jsx";

const call = (runtime, path, options = {}) => runtime.request(runtime.api + path, {...options, headers: {"X-Tenant-Id": runtime.tenant, "Content-Type": "application/json", ...(options.headers || {})}});
const amount = value => new Intl.NumberFormat("es-VE", {maximumFractionDigits: 6}).format(Number(value || 0));

export default function Inventory({runtime, productId = "", detailHref, backHref = ""}) {
  const requestedProduct = productId || detailFromHash("inventory");
  const productBackHref = backHref || `#/products/${encodeURIComponent(requestedProduct)}/view`;
  const inventoryDetailHref = id => detailHref ? detailHref(id) : `#/inventory/${encodeURIComponent(id)}/view`;
  const [nodes, setNodes] = useState([]), [node, setNode] = useState(""), [items, setItems] = useState([]), [query, setQuery] = useState(""), [selected, setSelected] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const write = runtime.permissions.includes("catalog.inventory.write");
  const visible = items.filter(item => `${item.product_name} ${item.product_code}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const load = useCallback(async (id = node) => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await call(runtime, `/v1/companies/${runtime.company}/nodes/${id}/inventory`);
      const rows = response.items || [];
      setItems(rows);
      setSelected(requestedProduct ? rows.find(item => item.product_id === requestedProduct) || null : null);
      setError("");
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [runtime, node, requestedProduct]);
  useEffect(() => {
    if (!runtime.company) return;
    call(runtime, `/v1/companies/${runtime.company}/nodes`).then(response => {
      const availableNodes = response.items || [], id = availableNodes[0]?.id || "";
      setNodes(availableNodes); setNode(id); if (id) load(id); else setLoading(false);
    }).catch(loadError => {setError(loadError.message); setLoading(false);});
  }, [runtime.company]);
  async function save(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice("");
    try {
      await call(runtime, `/v1/companies/${runtime.company}/nodes/${node}/inventory/${selected.product_id}/stock`, {method: "PUT", headers: {"Idempotency-Key": crypto.randomUUID()}, body: JSON.stringify({stock: Number(form.get("stock")), version: selected.version, reason: form.get("reason")})});
      await load(); setError(""); setNotice("Las existencias se actualizaron correctamente.");
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  }
  const nodeSelector = <label className="inventory-field">Nodo<select aria-label="Nodo de inventario" value={node} onChange={event => {setNode(event.target.value); setNotice(""); load(event.target.value);}}>{nodes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;

  if (requestedProduct) return <section className="inventory-module inventory-detail">
    <a className="inventory-back" href={productBackHref}>← {backHref ? "Volver a existencias" : "Volver al producto"}</a>
    <header className="inventory-heading"><div><nav>E-commerce / Inventario / Existencias</nav><h1>{selected?.product_name || "Existencias del producto"}</h1><p>Consulta y actualiza el stock de este producto por nodo.</p></div><button type="button" onClick={() => load()} disabled={busy}>Actualizar</button></header>
    {error && <div className="inventory-alert is-error" role="alert"><strong>No se pudo completar</strong><span>{error}</span></div>}
    {notice && <div className="inventory-alert is-success" role="status"><strong>Listo</strong><span>{notice}</span></div>}
    {loading ? <div className="inventory-surface"><LoadingState label="Cargando existencias del producto…"/></div> : selected ? <div className="inventory-detail-layout">
      <div className="inventory-surface"><div className="inventory-card-heading"><div><h2>Existencias por nodo</h2><p>Ajusta únicamente el stock físico. Las reservas se calculan desde las operaciones.</p></div></div><div className="inventory-form-section">
        <div className="inventory-node-field">{nodeSelector}</div>
        <div className="inventory-metrics"><div><span>Stock físico</span><strong>{amount(selected.stock)}</strong></div><div><span>Reservado</span><strong>{amount(selected.reserved)}</strong></div><div><span>Disponible</span><strong>{amount(selected.available)}</strong></div></div>
        {selected.initialized === false && <p className="inventory-empty-note">Este producto todavía no tiene existencias registradas en este nodo. Guarda el stock inicial para comenzar.</p>}
        {write ? <form className="inventory-adjustment" onSubmit={save}><h2>Actualizar existencias</h2><p>Indica el stock físico final y documenta el motivo del ajuste.</p><div className="inventory-fields"><label className="inventory-field">Stock final<input name="stock" type="number" min={selected.reserved} step=".000001" defaultValue={selected.stock} required/><small>No puede ser menor que el stock reservado ({amount(selected.reserved)}).</small></label><label className="inventory-field is-wide">Motivo del ajuste<textarea name="reason" maxLength="500" placeholder="Ej.: recepción inicial, conteo físico o corrección autorizada" required/></label></div><div className="inventory-actions"><a href={productBackHref}>Cancelar</a><button className="inventory-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar existencias"}</button></div></form> : <p className="inventory-empty-note">Tienes acceso de solo lectura para las existencias de este producto.</p>}
      </div></div>
      <aside className="inventory-surface inventory-summary"><h2>Producto</h2><dl><dt>Nombre</dt><dd>{selected.product_name}</dd><dt>Referencia</dt><dd>{selected.product_code || "Sin referencia"}</dd><dt>Nodo</dt><dd>{nodes.find(item => item.id === node)?.name || "Sin nodo"}</dd></dl></aside>
    </div> : !error && <div className="inventory-surface inventory-missing"><h2>Producto no disponible</h2><p>No encontramos este producto en el inventario de la empresa seleccionada.</p><a href={productBackHref}>Volver</a></div>}
  </section>;

  return <section className="inventory-module inventory-directory"><header className="inventory-heading"><div><nav>E-commerce / Inventario</nav><h1>Existencias por nodo</h1><p>Stock físico, reservado y disponible.</p></div><button type="button" onClick={() => load()} disabled={loading}>{loading ? "Actualizando…" : "Actualizar"}</button></header>{error && <div className="inventory-alert is-error" role="alert"><strong>No se pudo completar</strong><span>{error}</span></div>}<div className="inventory-toolbar">{nodeSelector}<label className="inventory-field inventory-search">Buscar producto o referencia<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre o PRD-…"/></label></div><div className="inventory-surface inventory-list" aria-busy={loading}>{loading ? <LoadingState label="Cargando existencias…"/> : visible.length ? visible.map(item => <a className="inventory-row" key={item.product_id} href={inventoryDetailHref(item.product_id)}><span><strong>{item.product_name}</strong><small>{item.product_code || "Sin referencia"}</small></span><span className="inventory-row-stock"><small>Físico / reservado / disponible</small>{amount(item.stock)} / {amount(item.reserved)} / <b>{amount(item.available)}</b></span></a>) : !error && <div className="inventory-missing"><h2>No encontramos productos</h2><p>Prueba otra búsqueda o revisa el nodo seleccionado.</p></div>}</div></section>;
}
