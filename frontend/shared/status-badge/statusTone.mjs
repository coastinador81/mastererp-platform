const tones={
  PENDING:'warning',PLANNED:'warning',PAUSED:'warning',
  CONFIRMED:'info',NOT_STARTED:'info',OUT_FOR_DELIVERY:'info',IN_ROUTE:'info',
  PREPARING:'violet',IN_PROGRESS:'violet',
  PREPARED:'success',READY:'success',DONE:'success',DELIVERED:'success',COMPLETED:'success',ACTIVE:'success',
  CANCELLED:'danger',SUSPENDED:'danger',
  DRAFT:'neutral',INACTIVE:'neutral',
};

export const statusTone=status=>tones[status]||'neutral';
