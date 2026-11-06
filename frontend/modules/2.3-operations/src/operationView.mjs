const labels={
  PENDING:'Pendiente',CONFIRMED:'Confirmado',PREPARING:'En preparación',PREPARED:'Preparado',READY:'Listo para despacho',OUT_FOR_DELIVERY:'En ruta',DELIVERED:'Entregado',CANCELLED:'Cancelado',
  NOT_STARTED:'Sin iniciar',IN_PROGRESS:'En preparación',DONE:'Listo',COMPLETED:'Completada',PLANNED:'Planificada',IN_ROUTE:'En ruta',
  DRAFT:'Borrador',ACTIVE:'Activo',PAUSED:'Pausado',SUSPENDED:'Suspendido',INACTIVE:'Inactivo',
};

export const readableStatus=value=>labels[value]||'Pendiente';
export const shortReference=(value,prefix='')=>`${prefix}${String(value||'').replaceAll('-','').slice(-6).toUpperCase()||'—'}`;
