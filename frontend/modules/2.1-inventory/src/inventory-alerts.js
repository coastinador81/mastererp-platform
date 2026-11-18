export const MOCK_INVENTORY_ALERT_SETTINGS = Object.freeze({
 today: '2026-11-18',
 expiryWarningDays: 7,
});

const dayMilliseconds = 24 * 60 * 60 * 1000;

function isExpired(expiryDate, today) {
 return Boolean(expiryDate && expiryDate < today);
}

function isLotUnavailable(lot, today) {
 return Boolean(lot.blocked || lot.quarantined || isExpired(lot.expiryDate, today));
}

export function getLotStatusTags(lot, settings = MOCK_INVENTORY_ALERT_SETTINGS) {
 if (!lot.expiryDate) return [{label:'Normal',tone:'good'}];
 if (isExpired(lot.expiryDate, settings.today)) return [{label:'Vencido',tone:'urgent'}];
 const daysUntilExpiry = Math.floor((Date.parse(`${lot.expiryDate}T00:00:00Z`)-Date.parse(`${settings.today}T00:00:00Z`))/dayMilliseconds);
 if (daysUntilExpiry <= settings.expiryWarningDays) return [{label:'Vence pronto',tone:'warning'}];
 return [{label:'Normal',tone:'good'}];
}

export function calculateAvailableInventory(lots, reserved = 0, settings = MOCK_INVENTORY_ALERT_SETTINGS) {
 const usablePhysical = lots.reduce((total,lot)=>total+(isLotUnavailable(lot,settings.today)?0:Math.max(0,Number(lot.quantity)||0)),0);
 const usableReserved = Math.min(usablePhysical,Math.max(0,Number(reserved)||0));
 return {usablePhysical,usableReserved,available:usablePhysical-usableReserved};
}

export function resolveInventoryMinimum({configuredMinimum,averageDailyDemand=0,replenishmentLeadTimeDays=0,safetyStock=0}) {
 if(Number.isFinite(configuredMinimum))return configuredMinimum;
 return Math.max(0,(Number(averageDailyDemand)||0)*(Number(replenishmentLeadTimeDays)||0)+(Number(safetyStock)||0));
}

export function getNodeStatusTags(lots,reserved,minimum,settings=MOCK_INVENTORY_ALERT_SETTINGS) {
 const {available}=calculateAvailableInventory(lots,reserved,settings);
 const tags=[];
 if(available<=minimum)tags.push({label:'Stock bajo',tone:'warning'});
 const lotTags=lots.filter(lot=>lot.quantity>0).flatMap(lot=>getLotStatusTags(lot,settings));
 for(const tag of lotTags){
  if(tag.label!=='Normal'&&!tags.some(existing=>existing.label===tag.label))tags.push(tag);
 }
 return tags.length?tags:[{label:'Normal',tone:'good'}];
}

export function getInventorySummaryStatus(itemStates, countLabel = 'nodos') {
 const attentionCount=itemStates.filter(item=>item.statusTags.some(tag=>tag.label!=='Normal')).length;
 return {
  label:attentionCount?'Requiere atención':'Normal',
  tone:attentionCount?'warning':'good',
  attentionCount,
  itemCount:itemStates.length,
  countLabel,
 };
}

export function getProductSummaryStatus(nodeStates) {
 const summary=getInventorySummaryStatus(nodeStates);
 return {...summary,attentionNodeCount:summary.attentionCount,nodeCount:summary.itemCount};
}

export function matchesInventoryAlertFilter(tags,selectedStatus) {
 if(!selectedStatus)return true;
 return tags.some(tag=>tag.label===selectedStatus);
}
