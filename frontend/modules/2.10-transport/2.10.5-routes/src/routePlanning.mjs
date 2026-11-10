export function readyOrdersForNode(orders, nodeId) {
  return (orders || []).filter(order => order.status === 'READY' && !order.route_ref && (!nodeId || order.branch_id === nodeId));
}

export function routePayload({ nodeId, date, deliveryWindow, orderIds }) {
  return { node_id: nodeId, date, delivery_window_ref: deliveryWindow.trim() || undefined, order_ids: orderIds };
}
