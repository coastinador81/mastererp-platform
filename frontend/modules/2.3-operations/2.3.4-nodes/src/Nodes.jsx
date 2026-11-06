import React, { useCallback, useEffect, useState } from "react";
import "./style.css";
import { DetailBackLink, DetailLink } from "../../../../app-shell/src/CommerceDetailLinks.jsx";
import { detailFromHash, readableStatus } from "../../src/operationView.mjs";
const call = (r, p, o = {}) =>
  r.request(r.api + p, {
    ...o,
    headers: {
      "X-Tenant-Id": r.tenant,
      "Content-Type": "application/json",
      ...(o.headers || {}),
    },
  });
export default function Nodes({ runtime, onSelect }) {
  const [items, setItems] = useState([]),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    write = runtime.permissions.includes("operations.nodes.write");
  const load = useCallback(async () => {
    try {
      const rows = (
        await call(runtime, `/v1/companies/${runtime.company}/nodes`)
      ).items;
      const requested = detailFromHash("nodes");
      setItems(rows);
      setSelected(requested ? rows.find((x) => x.id === requested) || null : null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [runtime]);
  useEffect(() => {
    if (runtime.company) load();
  }, [runtime.company]);
  async function save(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await call(
        runtime,
        `/v1/companies/${runtime.company}/nodes/${selected.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            version: selected.version,
            accepts_orders: f.get("accepts") === "on",
            coverage_radius_km: Number(f.get("radius")),
            daily_capacity: Number(f.get("capacity")),
            minimum_order: Number(f.get("minimum")),
            delivery_fee: Number(f.get("fee")),
          }),
        },
      );
      await load();
    } catch (x) {
      setError(x.message);
    }
  }
  return (
    <section className={`canonical-module nodes-module operation-directory ${selected ? "detail-open" : "list-open"}`}>
      <div className="page-heading">
        <div>
          <nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Gestión de e-Commerce</span></nav>
          <h1>Nodos</h1>
          <p className="supplier-subtitle">Configura las ubicaciones que atienden tus pedidos.</p>
        </div>
        <button onClick={load}>Actualizar</button>
      </div>
      {error && <p className="error" role="alert">No se pudieron cargar los nodos. Intenta nuevamente.</p>}
      <div className="operation-master-detail">
        <div className="panel operation-list">
          {items.map((n) => (
            <div className="operation-list-item"
              key={n.id}
            >
              <span>
                <strong>{n.name}</strong>
                <small>{n.code}</small>
              </span>
              <span className="row-action"><b className="status">{readableStatus(n.status)}</b><span onClick={() => onSelect?.(n)}><DetailLink route="nodes" id={n.id}/></span></span>
            </div>
          ))}
          {!items.length && <p>No hay nodos configurados.</p>}
        </div>
        <aside className="panel operation-detail">
          {selected && <DetailBackLink route="nodes" label="nodos"/>}
          {selected ? (
            write ? (
              <form onSubmit={save}>
                <div className="node-form-heading"><div><small>UBICACIÓN OPERATIVA</small><h2>{selected.name}</h2></div><span className="status">{readableStatus(selected.status)}</span></div>
                <label>
                  <input
                    name="accepts"
                    type="checkbox"
                    defaultChecked={selected.accepts_orders}
                  />{" "}
                  Acepta pedidos
                </label>
                <label>
                  Cobertura de entrega (km)
                  <input
                    name="radius"
                    type="number"
                    min="0"
                    step=".01"
                    defaultValue={selected.coverage_radius_km}
                  />
                </label>
                <label>
                  Capacidad diaria
                  <input
                    name="capacity"
                    type="number"
                    min="0"
                    defaultValue={selected.daily_capacity}
                  />
                </label>
                <label>
                  Pedido mínimo
                  <input
                    name="minimum"
                    type="number"
                    min="0"
                    step=".01"
                    defaultValue={selected.minimum_order}
                  />
                </label>
                <label>
                  Tarifa de entrega
                  <input
                    name="fee"
                    type="number"
                    min="0"
                    step=".01"
                    defaultValue={selected.delivery_fee}
                  />
                </label>
                <button className="primary">Guardar configuración</button>
              </form>
            ) : <div><div className="node-form-heading"><div><small>UBICACIÓN OPERATIVA</small><h2>{selected.name}</h2></div><span className="status">{readableStatus(selected.status)}</span></div><dl className="node-summary"><div><dt>Acepta pedidos</dt><dd>{selected.accepts_orders ? "Sí" : "No"}</dd></div><div><dt>Cobertura</dt><dd>{selected.coverage_radius_km} km</dd></div><div><dt>Capacidad diaria</dt><dd>{selected.daily_capacity}</dd></div><div><dt>Pedido mínimo</dt><dd>{selected.minimum_order}</dd></div><div><dt>Tarifa de entrega</dt><dd>{selected.delivery_fee}</dd></div></dl></div>
          ) : (
            <div className="operation-empty"><h2>Selecciona un nodo</h2><p>Verás aquí su configuración operativa.</p></div>
          )}
        </aside>
      </div>
    </section>
  );
}
