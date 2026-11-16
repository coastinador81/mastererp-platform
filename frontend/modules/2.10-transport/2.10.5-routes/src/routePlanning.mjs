export function readyOrdersForNode(orders, nodeId) {
  return (orders || []).filter(order => order.status === 'READY' && !order.route_ref && (!nodeId || order.branch_id === nodeId));
}

export function deliveryWindowRange(start, end) {
  if (!start || !end || start >= end) return '';
  return `${start}-${end}`;
}

export function routeTimeOptions(after = '') {
  const formatter = new Intl.DateTimeFormat('es-VE', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
  return Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2), minute = index % 2 ? 30 : 0;
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const label = formatter.format(new Date(Date.UTC(2026, 0, 1, hour, minute))).replaceAll('\u00a0', ' ');
    return { value, label };
  }).filter(option => !after || option.value > after);
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
