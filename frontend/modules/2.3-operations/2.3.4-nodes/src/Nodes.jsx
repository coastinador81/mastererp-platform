import React, { useCallback, useEffect, useState } from "react";
import "./style.css";
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
      setItems(rows);
      setSelected((old) => rows.find((x) => x.id === old?.id) || null);
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
    <section className="canonical-module nodes-module">
      <header>
        <div>
          <small>OPERACIONES · NODOS</small>
          <h1>Nodos operativos</h1>
          <p>Cada nodo amplía una sucursal existente.</p>
        </div>
        <button onClick={load}>Actualizar</button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="layout">
        <div className="list">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setSelected(n);
                onSelect?.(n);
              }}
            >
              <span>
                <strong>{n.name}</strong>
                <small>{n.code}</small>
              </span>
              <b>{n.status}</b>
            </button>
          ))}
        </div>
        <aside>
          {selected ? (
            write ? (
              <form onSubmit={save}>
                <h2>{selected.name}</h2>
                <label>
                  <input
                    name="accepts"
                    type="checkbox"
                    defaultChecked={selected.accepts_orders}
                  />{" "}
                  Acepta pedidos
                </label>
                <label>
                  Radio cobertura km
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
                  Tarifa entrega
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
            ) : (
              <p>Acceso de solo lectura.</p>
            )
          ) : (
            <p>Selecciona un nodo.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
