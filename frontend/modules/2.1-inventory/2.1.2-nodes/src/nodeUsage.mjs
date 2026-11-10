export function operationalOrdersByNode({orders=[],routes=[],preparations=[],today}){
  const preparationNodes=new Map(preparations.map(item=>[item.order_id,item.node_id]));
  const usage=new Map();
  const add=(nodeId,orderId)=>{if(!nodeId||!orderId)return;if(!usage.has(nodeId))usage.set(nodeId,new Set());usage.get(nodeId).add(orderId);};
  orders.filter(order=>String(order.created_at||'').slice(0,10)===today).forEach(order=>add(order.branch_id||order.node_id||order.node_ref||preparationNodes.get(order.id),order.id));
  routes.filter(route=>String(route.date||'').slice(0,10)===today).forEach(route=>(route.stops||[]).forEach(stop=>add(route.node_id,stop.order_id)));
  return Object.fromEntries([...usage].map(([nodeId,orderIds])=>[nodeId,orderIds.size]));
}

export const localDateKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
