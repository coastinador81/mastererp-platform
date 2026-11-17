export const routeLabel=status=>({ASSIGNED:'Asignada',IN_ROUTE:'En ruta',COMPLETED:'Completada',CANCELLED:'Cancelada'}[status]||status);
export const routeAllowsDelivery=route=>route?.status==='IN_ROUTE';

export function routeTotals(route){
 const stops=route?.stops||[];
 return {total:stops.length,delivered:stops.filter(stop=>stop.status==='DELIVERED').length,
  failed:stops.filter(stop=>stop.status==='FAILED').length};
}

export function filterRouteHistory(routes,query){
 const term=query.trim().toLowerCase();
 if(!term)return routes||[];
 return (routes||[]).filter(route=>[route.id,route.date,route.delivery_window_ref,routeLabel(route.status),
  ...(route.stops||[]).flatMap(stop=>[stop.order_id,stop.order_number,stop.customer?.name])]
  .filter(Boolean).join(' ').toLowerCase().includes(term));
}
