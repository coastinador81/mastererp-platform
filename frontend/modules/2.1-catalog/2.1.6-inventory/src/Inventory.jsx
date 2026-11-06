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
export default function Inventory({ runtime }) {
  const [nodes, setNodes] = useState([]),
    [node, setNode] = useState(""),
    [items, setItems] = useState([]),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    write = runtime.permissions.includes("catalog.inventory.write");
  const load = useCallback(
    async (id = node) => {
      if (!id) return;
      try {
        setItems(
          (
            await call(
              runtime,
              `/v1/companies/${runtime.company}/nodes/${id}/inventory`,
            )
          ).items,
        );
        setSelected(null);
        setError("");
      } catch (e) {
        setError(e.message);
      }
    },
    [runtime, node],
  );
  useEffect(() => {
    if (!runtime.company) return;
    call(runtime, `/v1/companies/${runtime.company}/nodes`)
      .then((x) => {
        setNodes(x.items);
        const id = x.items[0]?.id || "";
        setNode(id);
        if (id) load(id);
      })
      .catch((e) => setError(e.message));
  }, [runtime.company]);
  async function save(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await call(
        runtime,
        `/v1/companies/${runtime.company}/nodes/${node}/inventory/${selected.product_id}/stock`,
        {
          method: "PUT",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            stock: Number(f.get("stock")),
            version: selected.version,
            reason: f.get("reason"),
          }),
        },
      );
      await load();
    } catch (x) {
      setError(x.message);
    }
  }
  return (
    <section className="canonical-module inventory-module">
      <header>
        <div>
          <small>CATÁLOGO · INVENTARIO</small>
          <h1>Existencias por nodo</h1>
          <p>Stock físico, reservado y disponible.</p>
        </div>
        <button onClick={() => load()}>Actualizar</button>
      </header>
      <label>
        Nodo
        <select
          aria-label="Nodo de inventario"
          value={node}
          onChange={(e) => {
            setNode(e.target.value);
            load(e.target.value);
          }}
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="layout">
        <div className="list">
          {items.map((i) => (
            <button key={i.product_id} onClick={() => setSelected(i)}>
              <span>
                <strong>{i.product_name}</strong>
                <small>{i.product_code}</small>
              </span>
              <span className="row-action">
                {i.stock} / {i.reserved} / <b>{i.available}</b>
                <em>Ver detalle</em>
              </span>
            </button>
          ))}
        </div>
        <aside>
          {selected ? (
            write ? (
              <form onSubmit={save}>
                <h2>{selected.product_name}</h2>
                <p>Reservado: {selected.reserved}</p>
                <label>
                  Stock final
                  <input
                    name="stock"
                    type="number"
                    min={selected.reserved}
                    step=".000001"
                    defaultValue={selected.stock}
                    required
                  />
                </label>
                <label>
                  Motivo
                  <textarea name="reason" maxLength="500" required />
                </label>
                <button className="primary">Guardar ajuste</button>
              </form>
            ) : (
              <p>Acceso de solo lectura.</p>
            )
          ) : (
            <p>Selecciona un producto.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
