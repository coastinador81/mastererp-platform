export function summarizeOperations(data, now = new Date()) {
  const orders = data.orders || [];
  const today = orders.filter(order => new Date(order.created_at).toDateString() === now.toDateString());
  const amounts = new Map();
  for (const order of today) {
    if (order.status === 'CANCELLED') continue;
    const amount = Number(order.total);
    if (!Number.isFinite(amount) || !order.currency) continue;
    amounts.set(order.currency, (amounts.get(order.currency) || 0) + amount);
  }
  return {
    todayCount: today.length,
    amounts: [...amounts],
    preparing: (data.preparation || []).filter(item => item.status === 'IN_PROGRESS').length,
    delivering: orders.filter(order => order.status === 'OUT_FOR_DELIVERY').length,
    activeRoutes: (data.routes || []).filter(route => route.status === 'IN_ROUTE').length,
    recent: [...orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 5),
  };
}
