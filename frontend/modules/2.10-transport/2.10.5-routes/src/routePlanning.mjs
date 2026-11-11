export function readyOrdersForNode(orders, nodeId) {
  return (orders || []).filter(order => order.status === 'READY' && !order.route_ref && (!nodeId || order.branch_id === nodeId));
}

export function deliveryWindowRange(start, end) {
  if (!start || !end || start >= end) return '';
  return `${start}-${end}`;
}

export function routePayload({ nodeId, date, deliveryStart, deliveryEnd, orderIds }) {
  return { node_id: nodeId, date, delivery_window_ref: deliveryWindowRange(deliveryStart, deliveryEnd), order_ids: orderIds };
}

export function newestRoutes(routes) {
  return [...(routes || [])].sort((left, right) =>
    String(right.date || '').localeCompare(String(left.date || ''))
    || String(right.created_at || '').localeCompare(String(left.created_at || ''))
    || String(right.id || '').localeCompare(String(left.id || '')));
}
