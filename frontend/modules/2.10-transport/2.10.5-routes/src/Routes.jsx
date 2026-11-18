import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./style.css";
import { detailFromHash, detailHref, readableStatus, shortReference } from "../../../2.3-ecommerce/src/operationView.mjs";
import FinanceIcon from "../../../2.2-finance/src/FinanceIcon.jsx";
import StatusBadge from "../../../../shared/status-badge/StatusBadge.jsx";
import LoadingState from "../../../../shared/loading-state/LoadingState.jsx";
import Toast from "../../../../shared/toast/Toast.jsx";
import { newestRoutes, nodeWorkingHours, readyOrdersForNode, routeDurationLabel, routePayload, routeProgress, routeTimeLabel, shiftRouteTime } from "./routePlanning.mjs";

const call = (runtime, path, options = {}) =>
  runtime.request(runtime.api + path, {
    ...options,
    headers: {
      "X-Tenant-Id": runtime.tenant,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("es-VE", {
        dateStyle: "medium",
        ...(/^\d{4}-\d{2}-\d{2}$/.test(value) ? { timeZone: "UTC" } : {}),
      }).format(parsed);
};
const today = () => new Date().toISOString().slice(0, 10);

function RouteStops({ runtime, route }) {
  const [orders, setOrders] = useState({}),
    [loading, setLoading] = useState(true),
    canReadOrders = runtime.permissions.includes("operations.orders.read");
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all(canReadOrders ? route.stops.map((stop) => call(runtime, `/v1/companies/${runtime.company}/orders/${stop.order_id}`).catch(() => null)) : []).then((rows) => {
      if (live) {
        setOrders(Object.fromEntries(rows.filter(Boolean).map((order) => [order.id, order])));
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [runtime, route, canReadOrders]);
  if (loading) return <LoadingState label="Cargando paradas…" />;
  if (!route.stops.length) return <p className="table-message">Esta ruta no tiene paradas.</p>;
  return (
    <div className="route-stops">
      {route.stops.map((stop, index) => {
        const order = orders[stop.order_id],
          address = order?.delivery_snapshot?.address || order?.delivery_snapshot?.address_line_1;
        return (
          <article key={stop.order_id}>
            <span className="stop-number">{stop.sequence || index + 1}</span>
            <div>
              <strong>
                Parada {stop.sequence || index + 1} · {canReadOrders ? <a href={detailHref("orders", stop.order_id)}>Pedido {order?.number || shortReference(stop.order_id, "#")}</a> : `Pedido ${shortReference(stop.order_id, "#")}`}
              </strong>
              <small>{[order?.customer_snapshot?.name, address].filter(Boolean).join(" · ") || "Sin datos de entrega"}</small>
            </div>
            <StatusBadge status={stop.status}>{stop.status === "PENDING" ? "Pendiente de entrega" : readableStatus(stop.status)}</StatusBadge>
          </article>
        );
      })}
    </div>
  );
}

function TimeControl({ label, value, onChange, minimum = "00:00", maximum = "23:30" }) {
  return (
    <div className="route-time-point">
      <small>{label}</small>
      <div>
        <button type="button" aria-label={`Restar 30 minutos a ${label.toLowerCase()}`} disabled={value <= minimum} onClick={() => onChange(shiftRouteTime(value, -1, minimum, maximum))}>
          −
        </button>
        <strong>{routeTimeLabel(value)}</strong>
        <button type="button" aria-label={`Sumar 30 minutos a ${label.toLowerCase()}`} disabled={value >= maximum} onClick={() => onChange(shiftRouteTime(value, 1, minimum, maximum))}>
          +
        </button>
      </div>
    </div>
  );
}

function RouteTimeWindow({ start, end, minimum, maximum, onChange }) {
  const candidates = [
    ["Horario completo", minimum, maximum],
    ["Primer bloque", minimum, shiftRouteTime(minimum, 8, minimum, maximum)],
    ["Último bloque", shiftRouteTime(maximum, -8, minimum, maximum), maximum],
  ];
  const presets = candidates.filter((item, index) => item[1] < item[2] && candidates.findIndex((other) => other[1] === item[1] && other[2] === item[2]) === index);
  const updateStart = (value) => onChange(value, end <= value ? shiftRouteTime(value, 1, value, maximum) : end);
  return (
    <section className="route-time-window">
      <header>
        <div>
          <small>FRANJA DE ENTREGA</small>
          <strong>Dentro del horario operativo del nodo</strong>
        </div>
        <span aria-live="polite">{routeDurationLabel(start, end)}</span>
      </header>
      <div className="route-time-controls">
        <TimeControl label="Desde" value={start} minimum={minimum} maximum={shiftRouteTime(end, -1, minimum, maximum)} onChange={updateStart} />
        <i aria-hidden="true">→</i>
        <TimeControl label="Hasta" value={end} minimum={shiftRouteTime(start, 1, minimum, maximum)} maximum={maximum} onChange={(value) => onChange(start, value)} />
      </div>
      <div className="route-time-presets" aria-label="Franjas rápidas">
        {presets.map(([label, presetStart, presetEnd]) => (
          <button type="button" className={start === presetStart && end === presetEnd ? "active" : ""} aria-pressed={start === presetStart && end === presetEnd} key={label} onClick={() => onChange(presetStart, presetEnd)}>
            {label}
            <small>
              {routeTimeLabel(presetStart)} – {routeTimeLabel(presetEnd)}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

function RouteCreator({ nodes, orders, saving, onCancel, onCreate }) {
  const initialHours = nodeWorkingHours(nodes[0]);
  const [nodeId, setNodeId] = useState(nodes[0]?.id || ""),
    [routeDate, setRouteDate] = useState(today),
    [deliveryStart, setDeliveryStart] = useState(initialHours?.opening || ""),
    [deliveryEnd, setDeliveryEnd] = useState(initialHours?.closing || ""),
    [selected, setSelected] = useState([]);
  const available = useMemo(() => readyOrdersForNode(orders, nodeId), [orders, nodeId]);
  const workingHours = nodeWorkingHours(nodes.find((node) => node.id === nodeId));
  const validRange = workingHours && deliveryStart >= workingHours.opening && deliveryEnd <= workingHours.closing && deliveryStart < deliveryEnd;
  const selectNode = (id) => {
    const hours = nodeWorkingHours(nodes.find((node) => node.id === id));
    setNodeId(id);
    setSelected([]);
    setDeliveryStart(hours?.opening || "");
    setDeliveryEnd(hours?.closing || "");
  };
  const submit = (event) => {
    event.preventDefault();
    if (nodeId && routeDate && validRange && selected.length)
      onCreate(
        routePayload({
          nodeId,
          date: routeDate,
          deliveryStart,
          deliveryEnd,
          orderIds: selected,
        }),
      );
  };
  return (
    <form className="route-create" onSubmit={submit}>
      <header>
        <div>
          <small>PLANIFICACIÓN DE DESPACHO</small>
          <h2>Nueva ruta</h2>
          <p>Selecciona un nodo y los pedidos listos que saldrán juntos.</p>
        </div>
        <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </header>
      <div className="route-create-fields">
        <label>
          Nodo
          <select required value={nodeId} onChange={(event) => selectNode(event.target.value)}>
            <option value="">Selecciona un nodo</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.name} · {node.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha
          <input required type="date" min={today()} value={routeDate} onChange={(event) => setRouteDate(event.target.value)} />
        </label>
        {workingHours ? (
          <RouteTimeWindow
            start={deliveryStart}
            end={deliveryEnd}
            minimum={workingHours.opening}
            maximum={workingHours.closing}
            onChange={(start, end) => {
              setDeliveryStart(start);
              setDeliveryEnd(end);
            }}
          />
        ) : (
          <p className="route-hours-missing" role="alert">
            Este nodo no tiene un horario operativo configurado. Configúralo antes de crear la ruta.
          </p>
        )}
        {deliveryStart && deliveryEnd && !validRange ? (
          <p className="route-range-error" role="alert">
            La franja debe estar dentro del horario operativo del nodo.
          </p>
        ) : null}
      </div>
      <fieldset>
        <legend>Pedidos listos sin ruta</legend>
        {available.map((order) => (
          <label className="route-order" key={order.id}>
            <input type="checkbox" checked={selected.includes(order.id)} onChange={(event) => setSelected((current) => (event.target.checked ? [...current, order.id] : current.filter((id) => id !== order.id)))} />
            <span>
              <strong>Pedido {order.number}</strong>
              <small>
                {order.customer_snapshot?.name || "Cliente del pedido"} · {order.delivery_window_ref || "Sin franja solicitada"}
              </small>
            </span>
            <StatusBadge status={order.status}>Listo</StatusBadge>
          </label>
        ))}
        {nodeId && !available.length ? <p className="table-message">Este nodo no tiene pedidos listos pendientes de ruta.</p> : null}
      </fieldset>
      <footer>
        <span>
          {selected.length} {selected.length === 1 ? "pedido seleccionado" : "pedidos seleccionados"}
        </span>
        <button className="primary" disabled={saving || !nodeId || !routeDate || !validRange || !selected.length}>
          {saving ? "Creando ruta…" : "Crear ruta y asignar pedidos"}
        </button>
      </footer>
    </form>
  );
}

function RouteActions({ route, drivers, writable, canReadDrivers, saving, onAssign, onStart }) {
  const available = drivers.filter((driver) => driver.status === "ACTIVE" && driver.availability === "AVAILABLE" && (driver.node_ids || []).includes(route.node_id));
  const [driverId, setDriverId] = useState(available[0]?.id || "");
  useEffect(() => setDriverId(available[0]?.id || ""), [route.id, route.version]);
  if (!writable) return <p className="route-action-note">Acceso de solo lectura.</p>;
  if (route.status === "PLANNED")
    return (
      <div className="route-actions">
        <h3>Asignar repartidor</h3>
        {canReadDrivers ? (
          <>
            <select aria-label="Repartidor disponible" value={driverId} onChange={(event) => setDriverId(event.target.value)}>
              <option value="">Selecciona un repartidor</option>
              {available.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} · {driver.vehicle?.plate || "Sin placa"}
                </option>
              ))}
            </select>
            <button className="primary" disabled={saving || !driverId} onClick={() => onAssign(driverId)}>
              {saving ? "Asignando…" : "Asignar repartidor"}
            </button>
            {!available.length ? <p>No hay repartidores activos y disponibles asignados a este nodo.</p> : null}
          </>
        ) : (
          <p>Necesitas `transport.drivers.read` para seleccionar un repartidor.</p>
        )}
      </div>
    );
  if (route.status === "ASSIGNED")
    return (
      <div className="route-actions">
        <h3>Ruta preparada</h3>
        <p>Al iniciar, todos sus pedidos pasarán a «En ruta».</p>
        <button className="primary" disabled={saving} onClick={onStart}>
          {saving ? "Iniciando…" : "Iniciar ruta"}
        </button>
      </div>
    );
  return null;
}

export default function Routes({ runtime }) {
  const [items, setItems] = useState([]),
    [selected, setSelected] = useState(null),
    [orders, setOrders] = useState([]),
    [nodes, setNodes] = useState([]),
    [drivers, setDrivers] = useState([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [showStops, setShowStops] = useState(false),
    [creating, setCreating] = useState(false);
  const writable = runtime.permissions.includes("operations.routes.write"),
    canPlan = writable && runtime.permissions.includes("operations.orders.read") && runtime.permissions.includes("operations.nodes.read"),
    canReadDrivers = runtime.permissions.includes("transport.drivers.read");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requested = detailFromHash("routes"),
        [listed, orderRows, nodeRows, driverRows, requestedRoute] = await Promise.all([call(runtime, `/v1/companies/${runtime.company}/routes?limit=100`).then((value) => value.items), canPlan ? call(runtime, `/v1/companies/${runtime.company}/orders?status=READY&limit=100`).then((value) => value.items) : [], canPlan ? call(runtime, `/v1/companies/${runtime.company}/nodes`).then((value) => value.items) : [], canReadDrivers ? call(runtime, `/v1/companies/${runtime.company}/drivers`).then((value) => value.items) : [], requested ? call(runtime, `/v1/companies/${runtime.company}/routes/${requested}`) : null]),
        rows = newestRoutes(requestedRoute && !listed.some((item) => item.id === requestedRoute.id) ? [requestedRoute, ...listed] : listed);
      setItems(rows);
      setOrders(orderRows);
      setNodes(nodeRows);
      setDrivers(driverRows);
      setSelected((current) => rows.find((item) => item.id === (requested || current?.id)) || rows[0] || null);
      setError("");
    } catch (problem) {
      setError(problem.message);
    } finally {
      setLoading(false);
    }
  }, [runtime, canPlan, canReadDrivers]);
  useEffect(() => {
    if (runtime.company) void load();
  }, [runtime.company, load]);
  const create = async (payload) => {
    setSaving(true);
    setError("");
    try {
      await call(runtime, `/v1/companies/${runtime.company}/routes`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      setCreating(false);
      setNotice("Ruta creada correctamente.");
      await load();
    } catch (problem) {
      setError(problem.message);
    } finally {
      setSaving(false);
    }
  };
  const updateRoute = async (path, options) => {
    setSaving(true);
    setError("");
    try {
      const route = await call(runtime, path, options);
      setItems((current) => current.map((item) => (item.id === route.id ? route : item)));
      setSelected(route);
      setNotice("Ruta actualizada correctamente.");
    } catch (problem) {
      setError(problem.message);
    } finally {
      setSaving(false);
    }
  };
  const assignDriver = (driverId) =>
    updateRoute(`/v1/companies/${runtime.company}/routes/${selected.id}/driver`, {
      method: "PUT",
      body: JSON.stringify({
        version: selected.version,
        driver_id: driverId,
      }),
    });
  const startRoute = () =>
    updateRoute(`/v1/companies/${runtime.company}/routes/${selected.id}/transitions`, {
      method: "POST",
      body: JSON.stringify({ version: selected.version, status: "IN_ROUTE" }),
    });
  const selectedDriver = drivers.find((driver) => driver.id === selected?.driver_id);
  const selectedProgress = routeProgress(selected?.stops);
  return (
    <section className={`canonical-module routes-module operation-directory ${creating || selected ? "detail-open" : "list-open"}`}>
      <Toast message={error} tone="error" onClose={() => setError("")} />
      <Toast message={!error && notice} tone="success" onClose={() => setNotice("")} />
      <div className="page-heading">
        <div>
          <nav className="supplier-breadcrumb">
            <span>E-commerce</span>
            <span>/</span>
            <span className="current">Operaciones</span>
          </nav>
          <h1>Rutas</h1>
          <p className="supplier-subtitle">Planifica y supervisa las entregas de tus pedidos.</p>
        </div>
        <div className="route-heading-actions">
          {canPlan ? (
            <button className="primary" onClick={() => setCreating(true)}>
              + Nueva ruta
            </button>
          ) : null}
          <button disabled={loading} onClick={load}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>
      <div className="operation-master-detail">
        <div className="panel operation-list">
          <header>
            <div>
              <h2>Rutas planificadas</h2>
              <p>
                {items.length} rutas · {items.reduce((sum, route) => sum + route.stops.length, 0)} paradas
              </p>
            </div>
          </header>
          {items.map((route) => {
            const progress = routeProgress(route.stops);
            return (
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setSelected(route);
                  setShowStops(false);
                }}
                className={`operation-list-item ${selected?.id === route.id ? "selected" : ""}`}
                key={route.id}
              >
                <span className="ops-row-icon">
                  <FinanceIcon name="route" />
                </span>
                <span>
                  <strong>Ruta {shortReference(route.id, "#")}</strong>
                  <small>
                    {date(route.date)} · {route.delivery_window_ref || "Sin franja asignada"}
                  </small>
                  <i className="route-progress">
                    <b style={{ width: `${progress.percent}%` }} />
                  </i>
                </span>
                <span className="row-action">
                  <StatusBadge status={route.status}>{readableStatus(route.status)}</StatusBadge>
                  <small>
                    {progress.closed}/{progress.total} cerradas · {progress.delivered} entregadas · {progress.failed} no entregadas
                  </small>
                  <i>›</i>
                </span>
              </button>
            );
          })}
          {loading ? <LoadingState label="Cargando rutas…" /> : !items.length && <p className="table-message">No hay rutas planificadas.</p>}
        </div>
        <aside className="panel operation-detail route-detail">
          {creating ? (
            <RouteCreator nodes={nodes} orders={orders} saving={saving} onCancel={() => setCreating(false)} onCreate={create} />
          ) : selected ? (
            <>
              <div className="route-sequence" aria-label="Secuencia de paradas">
                {selected.stops.map((stop, index) => (
                  <span
                    key={stop.order_id}
                    style={{
                      left: `${10 + (index % 4) * 25}%`,
                      top: `${25 + (index % 2) * 42}%`,
                    }}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
              <header>
                <div>
                  <small>RUTA SELECCIONADA</small>
                  <h2>Ruta {shortReference(selected.id, "#")}</h2>
                  <p>
                    {selected.driver_id ? selectedDriver?.name || "Repartidor asignado" : "Repartidor sin asignar"} · {selected.stops.length} paradas
                  </p>
                </div>
                <StatusBadge status={selected.status}>{readableStatus(selected.status)}</StatusBadge>
              </header>
              <div className="route-facts">
                <span>
                  <small>Cierre de ruta</small>
                  <strong>
                    {selectedProgress.closed} de {selectedProgress.total} paradas cerradas
                  </strong>
                  <small>
                    {selectedProgress.delivered} entregadas · {selectedProgress.failed} no entregadas
                  </small>
                </span>
                <span>
                  <small>Fecha</small>
                  <strong>{date(selected.date)}</strong>
                </span>
                <span>
                  <small>Franja de entrega</small>
                  <strong>{selected.delivery_window_ref || "Sin asignar"}</strong>
                </span>
              </div>
              <RouteActions route={selected} drivers={drivers} writable={writable} canReadDrivers={canReadDrivers} saving={saving} onAssign={assignDriver} onStart={startRoute} />
              {showStops ? <RouteStops runtime={runtime} route={selected} /> : null}
              <button type="button" className="primary route-stops-toggle" aria-expanded={showStops} onClick={() => setShowStops((value) => !value)}>
                {showStops ? "Ocultar detalle" : "Ver detalle de la ruta"}
              </button>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
