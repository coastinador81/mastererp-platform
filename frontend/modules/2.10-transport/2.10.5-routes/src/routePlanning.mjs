export function readyOrdersForNode(orders, nodeId) {
  return (orders || []).filter(order => order.status === 'READY' && !order.route_ref && (!nodeId || order.branch_id === nodeId));
}

export function deliveryWindowRange(start, end) {
  if (!start || !end || start >= end) return '';
  return `${start}-${end}`;
}

const timeMinutes = value => value.split(':').reduce((hour, minute) => Number(hour) * 60 + Number(minute));

export function routeTimeLabel(value) {
  const [hour, minute] = value.split(':').map(Number);
  return new Intl.DateTimeFormat('es-VE', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, 0, 1, hour, minute))).replaceAll('\u00a0', ' ');
}

export function shiftRouteTime(value, steps, minimum = '00:00', maximum = '23:30') {
  const next = Math.min(timeMinutes(maximum), Math.max(timeMinutes(minimum), timeMinutes(value) + steps * 30));
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}

export function routeDurationLabel(start, end) {
  const minutes = timeMinutes(end) - timeMinutes(start), hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return [hours ? `${hours} h` : '', remainder ? `${remainder} min` : ''].filter(Boolean).join(' ');
}

export function nodeWorkingHours(node) {
  const opening = node?.opening_time?.slice(0, 5), closing = node?.closing_time?.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(opening) && /^\d{2}:\d{2}$/.test(closing) && opening < closing
    ? { opening, closing }
    : null;
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
