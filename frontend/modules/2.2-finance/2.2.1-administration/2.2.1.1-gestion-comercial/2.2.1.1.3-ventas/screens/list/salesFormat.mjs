export function amount(value,minimum=2){
 if(value===null||value===undefined)return '—';
 const match=String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
 if(!match)return '—';
 const fraction=(match[3]||'').replace(/0+$/,'').padEnd(minimum,'0');
 return match[1]+new Intl.NumberFormat('es-VE').format(BigInt(match[2]))+(fraction?','+fraction:'');
}
export function date(value){const parts=String(value||'').slice(0,10).split('-');return parts.length===3?parts.reverse().join('/'):'—';}
export function state(value){return value==='ACTIVE'?'Confirmada':value==='CANCELLED'?'Anulada':value||'—';}
export function origin(value){return value==='ecommerce'?'eCommerce':value||'—';}
