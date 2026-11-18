import React, { useMemo, useState } from "react";
import StatusBadge from "../../../../shared/status-badge/StatusBadge.jsx";
import { dateTime, returnableItems } from "./orderView.js";
import OrderAccordion from "./OrderAccordion.jsx";

const labels = {
  REQUESTED: "Solicitada",
  AUTHORIZED: "Autorizada",
  REJECTED: "Rechazada",
  RECEIVED: "Recibida",
  COMPLETED: "Completada",
};
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

function RequestForm({ items, submit, cancel }) {
  const [reason, setReason] = useState(""),
    [quantities, setQuantities] = useState({}),
    [saving, setSaving] = useState(false);
  const selected = useMemo(
    () =>
      items
        .filter((item) => positive(quantities[item.id]))
        .map((item) => ({
          order_item_id: item.id,
          quantity: Number(quantities[item.id]),
        })),
    [items, quantities],
  );
  async function send(event) {
    event.preventDefault();
    setSaving(true);
    const ok = await submit({ items: selected, reason: reason.trim() });
    setSaving(false);
    if (ok) cancel();
  }
  return (
    <form className="return-form" onSubmit={send}>
      <p>Selecciona únicamente productos efectivamente entregados que aún pueden devolverse.</p>
      {items.map((item) => (
        <label className="return-item" key={item.id}>
          <span>
            <strong>{item.product_name}</strong>
            <small>Disponible para devolver: {item.returnable_quantity}</small>
          </span>
          <input
            type="number"
            min="0"
            max={item.returnable_quantity}
            step="any"
            value={quantities[item.id] || ""}
            onChange={(event) =>
              setQuantities((value) => ({
                ...value,
                [item.id]: event.target.value,
              }))
            }
            aria-label={`Cantidad a devolver de ${item.product_name}`}
          />
        </label>
      ))}
      <label>
        Motivo de la devolución
        <textarea value={reason} maxLength="500" onChange={(event) => setReason(event.target.value)} required />
      </label>
      <div className="return-actions">
        <button type="button" className="od-button secondary" onClick={cancel}>
          Cancelar
        </button>
        <button className="od-button primary" disabled={saving || reason.trim().length < 3 || !selected.length}>
          {saving ? "Registrando…" : "Solicitar devolución"}
        </button>
      </div>
    </form>
  );
}

function ReceiptForm({ record, nodes, submit, cancel }) {
  const [node, setNode] = useState(Object.keys(nodes)[0] || ""),
    [draft, setDraft] = useState(() =>
      Object.fromEntries(
        record.items.map((item) => [
          item.id,
          {
            received: item.authorized_quantity,
            restocked: item.authorized_quantity,
            condition: "SELLABLE",
          },
        ]),
      ),
    ),
    [detail, setDetail] = useState("Recepción física verificada"),
    [saving, setSaving] = useState(false);
  const change = (id, key, value) =>
    setDraft((current) => ({
      ...current,
      [id]: { ...current[id], [key]: value },
    }));
  async function send(event) {
    event.preventDefault();
    setSaving(true);
    const items = record.items.map((item) => ({
      return_item_id: item.id,
      received_quantity: Number(draft[item.id].received),
      restocked_quantity: Number(draft[item.id].restocked),
      condition: draft[item.id].condition,
    }));
    const ok = await submit(record, {
      version: record.version,
      node_id: node,
      items,
      detail: detail.trim(),
    });
    setSaving(false);
    if (ok) cancel();
  }
  return (
    <form className="return-form" onSubmit={send}>
      <label>
        Nodo que recibe
        <select value={node} onChange={(event) => setNode(event.target.value)} required>
          <option value="">Selecciona un nodo</option>
          {Object.entries(nodes).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {record.items.map((item) => (
        <div className="return-receipt-row" key={item.id}>
          <strong>Línea autorizada: {item.authorized_quantity}</strong>
          <label>
            Recibida
            <input type="number" min="0" max={item.authorized_quantity} step="any" value={draft[item.id].received} onChange={(event) => change(item.id, "received", event.target.value)} />
          </label>
          <label>
            Reintegrar
            <input type="number" min="0" max={draft[item.id].received} step="any" value={draft[item.id].restocked} onChange={(event) => change(item.id, "restocked", event.target.value)} />
          </label>
          <label>
            Condición
            <select value={draft[item.id].condition} onChange={(event) => change(item.id, "condition", event.target.value)}>
              <option value="SELLABLE">Apto para venta</option>
              <option value="DAMAGED">Dañado</option>
              <option value="INCOMPLETE">Incompleto</option>
              <option value="OTHER">Otra</option>
            </select>
          </label>
        </div>
      ))}
      <label>
        Observación
        <textarea value={detail} maxLength="500" onChange={(event) => setDetail(event.target.value)} required />
      </label>
      <div className="return-actions">
        <button type="button" className="od-button secondary" onClick={cancel}>
          Cancelar
        </button>
        <button className="od-button primary" disabled={saving || !node || detail.trim().length < 3}>
          {saving ? "Guardando…" : "Confirmar recepción"}
        </button>
      </div>
    </form>
  );
}

export default function OrderReturns({ order, records = [], permissions = [], nodes, requestReturn, decideReturn, receiveReturn }) {
  const [requesting, setRequesting] = useState(false),
    [receiving, setReceiving] = useState("");
  const available = useMemo(() => returnableItems(order, records), [order, records]);
  const canRequest = permissions.includes("operations.returns.write") && order.status === "DELIVERED" && available.length > 0;
  const canAuthorize = permissions.includes("operations.returns.authorize");
  const canReceive = permissions.includes("catalog.inventory.returns.receive");
  async function decide(record, decision) {
    const detail = window.prompt(decision === "AUTHORIZED" ? "Motivo de la autorización" : "Motivo del rechazo");
    if (!detail?.trim()) return;
    await decideReturn(record, {
      version: record.version,
      decision,
      detail: detail.trim(),
    });
  }
  const action =
    canRequest && !requesting ? (
      <button
        className="od-button secondary"
        onClick={(event) => {
          event.preventDefault();
          event.currentTarget.closest("details").open = true;
          setRequesting(true);
        }}
      >
        Nueva devolución
      </button>
    ) : null;
  return (
    <OrderAccordion className="order-returns" title="Devoluciones y reembolsos" description="Expedientes coordinados con Inventario y Finanzas." actions={action}>
      {requesting ? <RequestForm items={available} submit={requestReturn} cancel={() => setRequesting(false)} /> : null}
      {!records.length && !requesting ? (
        <p className="od-section-empty">Este pedido no tiene devoluciones registradas.</p>
      ) : (
        records.map((record) => (
          <article className="return-case" key={record.id}>
            <header>
              <div>
                <strong>{record.number}</strong>
                <small>{dateTime(record.requested_at)}</small>
              </div>
              <StatusBadge status={record.status}>{labels[record.status] || record.status}</StatusBadge>
            </header>
            <p>{record.reason}</p>
            <dl>
              <div>
                <dt>Solicitadas</dt>
                <dd>{record.items.reduce((sum, item) => sum + Number(item.requested_quantity || 0), 0)}</dd>
              </div>
              <div>
                <dt>Recibidas</dt>
                <dd>{record.items.reduce((sum, item) => sum + Number(item.received_quantity || 0), 0)}</dd>
              </div>
              <div>
                <dt>Reintegradas</dt>
                <dd>{record.items.reduce((sum, item) => sum + Number(item.restocked_quantity || 0), 0)}</dd>
              </div>
            </dl>
            {record.status === "REQUESTED" && canAuthorize ? (
              <div className="return-actions">
                <button className="od-button danger" onClick={() => decide(record, "REJECTED")}>
                  Rechazar
                </button>
                <button className="od-button primary" onClick={() => decide(record, "AUTHORIZED")}>
                  Autorizar
                </button>
              </div>
            ) : null}
            {record.status === "AUTHORIZED" && canReceive && !receiving ? (
              <button className="od-button primary" onClick={() => setReceiving(record.id)}>
                Registrar recepción
              </button>
            ) : null}
            {receiving === record.id ? <ReceiptForm record={record} nodes={nodes} submit={receiveReturn} cancel={() => setReceiving("")} /> : null}
            {record.status === "RECEIVED" ? <p className="return-finance-pending">Recepción e inventario registrados. Pendiente de reembolso y nota de crédito en Finanzas.</p> : null}
            {record.status === "COMPLETED" ? (
              <p className="return-complete">
                Reembolso: {record.refund_reference} · Nota de crédito: {record.credit_note_reference}
              </p>
            ) : null}
          </article>
        ))
      )}
    </OrderAccordion>
  );
}
