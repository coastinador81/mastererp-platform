// Cálculos exclusivos del prototipo DEMO de unidades enteras en Bs.
export const proposalOf=value=>({quantity:String(value.quantity),price:String(value.price),supplier:value.supplier});
export function validateProposal(value){
 if(!/^\d+$/.test(value.quantity)||Number(value.quantity)<1||Number(value.quantity)>1000000)return 'La cantidad debe ser un número entero entre 1 y 1.000.000.';
 if(!/^\d+(\.\d{1,2})?$/.test(value.price)||Number(value.price)<=0||Number(value.price)>1000000)return 'Indica un precio positivo de hasta 1.000.000, con un máximo de dos decimales.';
 if(!value.supplier.trim()||value.supplier.trim().length>160)return 'Indica un proveedor de hasta 160 caracteres.';
 return '';
}
export const cleanProposal=value=>({quantity:Number(value.quantity),price:Number(value.price),supplier:value.supplier.trim()});
export const totalOf=value=>Number(value.quantity)*Math.round(Number(value.price)*100)/100;
export const changedProposal=(a,b)=>Number(a.quantity)!==Number(b.quantity)||Number(a.price)!==Number(b.price)||a.supplier.trim()!==b.supplier.trim();
