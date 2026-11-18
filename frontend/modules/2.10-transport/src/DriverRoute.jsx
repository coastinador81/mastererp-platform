import React, { useCallback, useEffect, useState } from "react";
import StatusBadge from "../../../shared/status-badge/StatusBadge.jsx";
import LoadingState from "../../../shared/loading-state/LoadingState.jsx";
import Toast from "../../../shared/toast/Toast.jsx";
import { deliveryCoordinates, driverPosition, locationErrorMessage } from "./driverLocation.mjs";
import { filterRouteHistory, routeLabel, routeTotals } from "./driverRouteView.mjs";
import "./driverRouteHistory.css";
const call = (runtime, path, options = {}) =>
  runtime.request(runtime.api + path, {
    ...options,
    headers: {
      "X-Tenant-Id": runtime.tenant,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
const itemKey = (item) => item.id || item.product_id;
function StopItems({ stop, expanded, onToggle }) {
  const items = stop.items || [],
    open = expanded === stop.order_id,
    visible = open ? items : stop.status === "PENDING" ? items.slice(0, 3) : [];
  return (
    <div className="driver-stop-items">
      <div>
        <b>
          {items.length} {items.length === 1 ? "producto" : "productos"}
        </b>
        {items.length ? (
          <button type="button" onClick={() => onToggle(open ? null : stop.order_id)} aria-expanded={open}>
            {open ? "Ocultar productos" : `Ver productos (${items.length})`}
          </button>
        ) : null}
      </div>
      {visible.length ? (
        <div className="driver-stop-item-list">
          {visible.map((item) => (
            <span key={itemKey(item)}>
              {item.quantity} × {item.name}
            </span>
          ))}
          {!open && items.length > 3 ? <small>y {items.length - 3} más…</small> : null}
        </div>
      ) : items.length ? null : (
        <span>Sin productos disponibles</span>
      )}
    </div>
  );
}
function RouteStops({ route, saving, expanded, setExpanded, onFinish }) {
  const active = route.status === "IN_ROUTE";
  return (
    <div className="driver-route-stops">
      {route.stops.map((stop) => (
        <article key={stop.order_id}>
          <span className="stop-number">{stop.sequence}</span>
          <div className="driver-stop-detail">
            <strong>{stop.customer?.name || "Cliente no disponible"}</strong>
            <small className="order-number">Pedido {stop.order_number || stop.order_id.slice(0, 8).toUpperCase()}</small>
            {stop.customer?.phone ? <a href={`tel:${stop.customer.phone}`}>{stop.customer.phone}</a> : <small>Teléfono no disponible</small>}
            <address>{[stop.delivery?.address, stop.delivery?.unit, stop.delivery?.zone].filter(Boolean).join(", ") || "Dirección no disponible"}</address>
            {stop.delivery?.reference ? <small>Referencia: {stop.delivery.reference}</small> : null}
            <StopItems stop={stop} expanded={expanded} onToggle={setExpanded} />
          </div>
          <StatusBadge status={stop.status}>{stop.status === "PENDING" ? "Pendiente" : stop.status === "DELIVERED" ? "Entregado" : "No entregado"}</StatusBadge>
          {stop.status === "PENDING" && active ? (
            <div className="driver-stop-actions">
              <button disabled={!!saving} className="primary" onClick={() => onFinish(stop, "DELIVERED")}>
                {saving === stop.order_id ? "Validando ubicación…" : "Entregado"}
              </button>
              <button disabled={!!saving} className="secondary" onClick={() => onFinish(stop, "FAILED")}>
                No entregado
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
function RouteHistory({ routes, query, setQuery, openId, setOpenId }) {
  const history = filterRouteHistory(routes, query);
  return (
    <section className="driver-route-history">
      <header>
        <div>
          <h2>Historial de mis rutas</h2>
          <p>Rutas completadas o canceladas vinculadas a tu perfil.</p>
        </div>
        <input type="search" aria-label="Buscar en mi historial de rutas" placeholder="Buscar ruta, pedido o cliente" value={query} onChange={(event) => setQuery(event.target.value)} />
      </header>
      {history.length ? (
        <div className="driver-history-list">
          {history.map((route) => {
            const totals = routeTotals(route),
              open = openId === route.id;
            return (
              <article key={route.id}>
                <button type="button" className="secondary driver-history-toggle" onClick={() => setOpenId(open ? "" : route.id)} aria-expanded={open}>
                  <span>
                    <strong>Ruta #{route.id.slice(-6).toUpperCase()}</strong>
                    <small>
                      {route.date} · {route.delivery_window_ref || "Sin franja"}
                    </small>
                  </span>
                  <span>
                    <StatusBadge status={route.status}>{routeLabel(route.status)}</StatusBadge>
                    <small>
                      {totals.delivered} entregadas · {totals.failed} no entregadas
                    </small>
                  </span>
                </button>
                {open ? (
                  <div className="driver-history-stops">
                    {route.stops.map((stop) => (
                      <div key={stop.order_id}>
                        <span>{stop.sequence}</span>
                        <span>
                          <strong>{stop.order_number || `Pedido ${stop.order_id.slice(0, 8).toUpperCase()}`}</strong>
                          <small>{stop.customer?.name || "Cliente no disponible"}</small>
                        </span>
                        <StatusBadge status={stop.status}>{stop.status === "DELIVERED" ? "Entregado" : stop.status === "FAILED" ? "No entregado" : "Pendiente"}</StatusBadge>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="driver-history-empty">{query ? "No hay rutas que coincidan con la búsqueda." : "Todavía no tienes rutas cerradas."}</p>
      )}
    </section>
  );
}
export default function DriverRoute({ runtime }) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [failedStop, setFailedStop] = useState(null),
    [reason, setReason] = useState(""),
    [expanded, setExpanded] = useState(null),
    [query, setQuery] = useState(""),
    [historyRoute, setHistoryRoute] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await call(runtime, `/v1/companies/${runtime.company}/driver-route`));
    } catch (problem) {
      setError(problem.status === 403 ? "Tu usuario no está vinculado a un perfil de repartidor activo." : problem.message || "No se pudo cargar tu ruta.");
    } finally {
      setLoading(false);
    }
  }, [runtime]);
  useEffect(() => {
    void load();
  }, [load]);
  const finish = async (stop, status, failureReason = "") => {
    if (status === "DELIVERED" && (!Number.isFinite(stop.delivery?.latitude) || !Number.isFinite(stop.delivery?.longitude))) {
      setError("Este pedido no tiene coordenadas de entrega. Corrige su dirección antes de registrarlo como entregado. Puedes marcarlo como no entregado e indicar el motivo.");
      return;
    }
    setSaving(stop.order_id);
    setError("");
    try {
      const evidence = status === "DELIVERED" ? deliveryCoordinates(await driverPosition()) : { reason: failureReason };
      await call(runtime, `/v1/companies/${runtime.company}/routes/${data.route.id}/driver-deliveries/${stop.order_id}`, { method: "POST", body: JSON.stringify({ status, evidence }) });
      setFailedStop(null);
      setReason("");
      setNotice(status === "DELIVERED" ? "Entrega registrada correctamente." : "Entrega no realizada registrada.");
      await load();
    } catch (problem) {
      setError(locationErrorMessage(problem));
    } finally {
      setSaving("");
    }
  };
  const requestFinish = (stop, status) => {
    if (status === "FAILED") {
      setFailedStop(stop);
      setReason("");
      setError("");
      return;
    }
    void finish(stop, status);
  };
  const startRoute = async () => {
    setSaving("route-start");
    setError("");
    try {
      setData(await call(runtime, `/v1/companies/${runtime.company}/driver-route/start`, { method: "POST", body: "{}" }));
      setNotice("Ruta iniciada correctamente.");
    } catch (problem) {
      setError(locationErrorMessage(problem));
    } finally {
      setSaving("");
    }
  };
  const confirmFailure = () => {
    const clean = reason.trim();
    if (!clean) {
      setError("Indica el motivo de la entrega no realizada.");
      return;
    }
    void finish(failedStop, "FAILED", clean);
  };
  if (loading) return <LoadingState label="Cargando tus rutas…" />;
  if (error && !data)
    return (
      <div className="notice error" role="alert">
        {error}
        <button type="button" onClick={load}>
          Reintentar
        </button>
      </div>
    );
  const route = data?.route,
    resolved = route?.stops.filter((stop) => stop.status !== "PENDING").length || 0;
  return (
    <section className="driver-route">
      <Toast message={error} tone="error" onClose={() => setError("")} />
      <Toast message={!error && notice} tone="success" onClose={() => setNotice("")} />
      <header>
        <div>
          <p className="eyebrow">MI RUTA</p>
          <h1>{route ? "Ruta activa" : "Sin ruta activa"}</h1>
          <p>{route ? `${route.date} · ${resolved} de ${route.stops.length} paradas cerradas` : "No tienes una ruta asignada o en curso para esta empresa."}</p>
        </div>
        {route ? <StatusBadge status={route.status}>{routeLabel(route.status)}</StatusBadge> : null}
      </header>
      {route?.status === "ASSIGNED" ? (
        <div className="notice driver-route-start" role="status">
          <span>Esta ruta está asignada. Iníciala cuando estés listo para salir.</span>
          <button type="button" disabled={!!saving} onClick={startRoute}>
            {saving === "route-start" ? "Iniciando…" : "Iniciar ruta"}
          </button>
        </div>
      ) : null}
      {route ? <RouteStops route={route} saving={saving} expanded={expanded} setExpanded={setExpanded} onFinish={requestFinish} /> : null}
      <RouteHistory routes={data?.routes || []} query={query} setQuery={setQuery} openId={historyRoute} setOpenId={setHistoryRoute} />
      {failedStop ? (
        <div className="failure-dialog" role="dialog" aria-modal="true" aria-labelledby="failure-title">
          <div>
            <h2 id="failure-title">Registrar entrega no realizada</h2>
            <p>Indica qué ocurrió para devolver el pedido a planificación.</p>
            <label htmlFor="failure-reason">Motivo</label>
            <textarea id="failure-reason" value={reason} maxLength={500} autoFocus onChange={(event) => setReason(event.target.value)} placeholder="Ej. Cliente ausente o dirección incorrecta" />
            <div className="failure-actions">
              <button className="secondary" disabled={!!saving} onClick={() => setFailedStop(null)}>
                Cancelar
              </button>
              <button className="primary" disabled={!!saving || !reason.trim()} onClick={confirmFailure}>
                {saving ? "Guardando…" : "Confirmar no entregado"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
