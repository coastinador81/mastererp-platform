const tones={
  PENDING:'warning',PLANNED:'warning',PAUSED:'warning',REQUESTED:'warning',RECEIVED:'warning',
  CONFIRMED:'info',ASSIGNED:'info',AUTHORIZED:'info',NOT_STARTED:'info',OUT_FOR_DELIVERY:'info',IN_ROUTE:'info',ON_ROUTE:'info',
  PREPARING:'violet',IN_PROGRESS:'violet',
  PREPARED:'success',READY:'success',DONE:'success',DELIVERED:'success',COMPLETED:'success',ACTIVE:'success',AVAILABLE:'success',
  CANCELLED:'danger',FAILED:'danger',REJECTED:'danger',SUSPENDED:'danger',
  DRAFT:'neutral',INACTIVE:'neutral',OFFLINE:'neutral',
};

export const statusTone=status=>tones[status]||'neutral';
