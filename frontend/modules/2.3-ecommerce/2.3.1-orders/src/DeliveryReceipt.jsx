import React, {useState} from 'react';
import {dateTime, money} from './orderView.js';
import {createOrderPdf} from './orderPdf.js';

const number=value=>value==null?'No registrado':new Intl.NumberFormat('es-VE',{maximumFractionDigits:4}).format(Number(value));
const routeNumber=id=>String(id||'').slice(-6).toUpperCase();

async function downloadPdf(order,attempt,companyProfile){
 const evidence=attempt.evidence||{},customer=order.customer_snapshot||{},delivery=order.delivery_snapshot||{};
 const {line,heading,total,note,finish}=await createOrderPdf({companyProfile,title:'Comprobante de entrega',kicker:'OPERACIONES · COMPROBANTE DE ENTREGA',metadata:{subject:'Evidencia operativa de entrega registrada por Rutas'}});
 line('Pedido',order.number);line('Documento',`CE-${routeNumber(attempt.route_id)}-${attempt.stop_sequence??'S/N'}`);
 heading('Datos de la entrega');line('Resultado','Entregado');line('Fecha y hora',dateTime(attempt.updated_at));line('Ruta',`Ruta #${routeNumber(attempt.route_id)}`);line('Parada',attempt.stop_sequence??'No registrada');line('Repartidor',attempt.driver_name||'No registrado');line('Cliente',customer.name||'No registrado');line('Dirección',delivery.address||delivery.address_line_1||'No registrada');line('Observaciones',evidence.observations||evidence.notes||'Sin observaciones registradas');
 heading('Evidencia de ubicación');line('Coordenadas',`${number(evidence.latitude)}, ${number(evidence.longitude)}`);line('Precisión GPS',`${number(evidence.accuracy_meters)} m`);line('Distancia al destino',`${number(evidence.distance_meters)} m`);line('Registrado',dateTime(evidence.recorded_at||attempt.updated_at));
 heading('Productos entregados');for(const item of order.items||[])line(`${item.quantity} × ${item.product_name||'Producto'}`,money(item.subtotal,order.currency));total(`TOTAL  ${money(order.total,order.currency)}`);
 note('Documento operativo generado a partir de la evidencia registrada por Rutas. No sustituye una factura fiscal.');
 finish(`comprobante-entrega-${order.number}`);
}

export default function DeliveryReceipt({order,attempt,companyProfile}){
 const [open,setOpen]=useState(false),[message,setMessage]=useState(''),[working,setWorking]=useState(false);
 if(!attempt||attempt.status!=='DELIVERED')return null;
 const evidence=attempt.evidence||{};
 async function download(){setWorking(true);setMessage('');try{await downloadPdf(order,attempt,companyProfile);setMessage('Comprobante PDF descargado.');}catch{setMessage('No se pudo generar el PDF. Inténtalo nuevamente.');}finally{setWorking(false);}}
 return <div className="delivery-receipt"><button type="button" className="od-button secondary" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>{open?'Ocultar comprobante':'Ver comprobante'}</button>{open?<div className="delivery-receipt-preview"><h3>Comprobante de entrega</h3><dl><div><dt>Pedido</dt><dd>{order.number}</dd></div><div><dt>Ruta</dt><dd>Ruta #{routeNumber(attempt.route_id)}</dd></div><div><dt>Parada</dt><dd>{attempt.stop_sequence??'No registrada'}</dd></div><div><dt>Entregado</dt><dd>{dateTime(attempt.updated_at)}</dd></div><div><dt>Repartidor</dt><dd>{attempt.driver_name||'No registrado'}</dd></div><div><dt>Observaciones</dt><dd>{evidence.observations||evidence.notes||'Sin observaciones registradas'}</dd></div></dl><button type="button" className="od-button primary" disabled={working} onClick={download}>{working?'Generando PDF…':'Descargar PDF'}</button><small role="status">{message}</small><p>No sustituye una factura fiscal.</p></div>:null}</div>;
}
