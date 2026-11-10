export const QUEUE_STATUSES = ['CONFIRMED', 'PREPARING', 'READY'];

const STAGES = {
  NOT_STARTED: ['Por iniciar', 'info'],
  IN_PROGRESS: ['En preparación', 'violet'],
  READY: ['Listo para despacho', 'success'],
};

export function buildQueue(orders, preparations) {
  const byOrder = new Map(preparations.map(preparation => [preparation.order_id, preparation]));
  return orders
    .filter(order => QUEUE_STATUSES.includes(order.status))
    .map(order => {
      const preparation = byOrder.get(order.id) || null;
      const lines = new Map((order.items || []).map(line => [line.id, line]));
      const items = preparation
        ? preparation.items.map(item => ({ ...item, line: lines.get(item.line_id) }))
        : (order.items || []).map(line => ({ line_id: line.id, status: 'PENDING', line }));
      return { order, preparation, items, stage: stageOf(order, preparation) };
    })
    .sort((a, b) => new Date(a.order.created_at) - new Date(b.order.created_at));
}

export function stageOf(order, preparation) {
  if (order.status === 'READY') return 'READY';
  return preparation?.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'NOT_STARTED';
}

export const stageLabel = stage => STAGES[stage] || STAGES.NOT_STARTED;

export function progressOf(entry) {
  if (entry.stage === 'READY') return 100;
  if (!entry.preparation || !entry.items.length) return 0;
  return Math.round(entry.items.filter(item => item.status === 'DONE').length / entry.items.length * 100);
}

export const canComplete = entry => entry.stage === 'IN_PROGRESS' && entry.items.length > 0 && entry.items.every(item => item.status === 'DONE');
