const availabilityLabels={AVAILABLE:'Disponible',OFFLINE:'Desconectado',ON_ROUTE:'En ruta'};
const outcomeLabels={DELIVERED:'Entregado',FAILED:'Entrega fallida',PENDING:'Pendiente'};
const accessLabels={PENDING:'Pendiente',LINKED:'Vinculado',ERROR:'Con error',DISABLED:'Deshabilitado'};

export const driverAvailability=value=>availabilityLabels[value]||'Sin disponibilidad';
export const driverAccess=value=>accessLabels[value]||'Sin vincular';

export function routeOutcome(routeStatus,stopStatus){
  if(routeStatus==='CANCELLED'&&stopStatus==='PENDING')return'No ejecutada (ruta cancelada)';
  return outcomeLabels[stopStatus]||stopStatus||'Sin resultado';
}

export function driverStats(routes=[]){
  return routes.flatMap(route=>route.stops||[]).reduce((result,stop)=>{
    if(stop.status==='DELIVERED')result.delivered+=1;
    else if(stop.status==='FAILED')result.failed+=1;
    else result.pending+=1;
    return result;
  },{delivered:0,failed:0,pending:0});
}
