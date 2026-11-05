import React from 'react';
import { money } from './orderView.js';

export default function OrderMetrics({ orders }) {
  const active = orders.filter(order => !['DELIVERED', 'CANCELLED'].includes(order.status)).length;
  const preparing = orders.filter(order => ['CONFIRMED', 'PREPARING'].includes(order.status)).length;
  const dispatch = orders.filter(order => ['READY', 'OUT_FOR_DELIVERY'].includes(order.status)).length;
  const sales = orders.filter(order => order.status !== 'CANCELLED').reduce((sum, order) => sum + Number(order.total || 0), 0);
  return <div className="order-metrics" aria-label="Resumen de pedidos">
    <article><span>Pedidos activos</span><strong>{active}</strong><small>requieren seguimiento</small></article>
    <article><span>En preparación</span><strong>{preparing}</strong><small>confirmados y preparando</small></article>
    <article><span>Listos / reparto</span><strong>{dispatch}</strong><small>en etapa de entrega</small></article>
    <article><span>Valor visible</span><strong>{money(sales, orders[0]?.currency)}</strong><small>sin pedidos cancelados</small></article>
  </div>;
}
