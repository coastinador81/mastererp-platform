import React, {useState} from 'react';
import {dateTime, money} from './orderView.js';

const number=value=>value==null?'No registrado':new Intl.NumberFormat('es-VE',{maximumFractionDigits:4}).format(Number(value));
const routeNumber=id=>String(id||'').slice(-6).toUpperCase();
const filename=value=>String(value||'pedido').replace(/[^a-zA-Z0-9_-]/g,'');

async function downloadPdf(order,attempt){
 const {jsPDF}=await import('jspdf'),pdf=new jsPDF({unit:'mm',format:'a4'}),evidence=attempt.evidence||{},customer=order.customer_snapshot||{},delivery=order.delivery_snapshot||{};
 let y=18;
 const line=(label,value)=>{pdf.setFont('helvetica','bold');pdf.text(`${label}:`,18,y);pdf.setFont('helvetica','normal');const rows=pdf.splitTextToSize(String(value??'No registrado'),135);pdf.text(rows,55,y);y+=Math.max(7,rows.length*5);};
 const heading=value=>{y+=3;pdf.setFont('helvetica','bold');pdf.setFontSize(13);pdf.text(value,18,y);pdf.line(18,y+2,192,y+2);pdf.setFontSize(10);y+=9;};
 pdf.setProperties({title:`Comprobante de entrega ${order.number}`,subject:'Evidencia operativa de entrega registrada por Rutas',creator:'MasterERP'});
 pdf.setFontSize(18);pdf.setFont('helvetica','bold');pdf.text('Comprobante de entrega',18,y);pdf.setFontSize(10);pdf.setFont('helvetica','normal');y+=9;line('Pedido',order.number);
 heading('Entrega');line('Resultado','Entregado');line('Fecha y hora',dateTime(attempt.updated_at));line('Ruta',`Ruta #${routeNumber(attempt.route_id)}`);line('Parada',attempt.stop_sequence??'No registrada');line('Repartidor',attempt.driver_name||'No registrado');line('Cliente',customer.name||'No registrado');line('Dirección',delivery.address||delivery.address_line_1||'No registrada');line('Observaciones',evidence.observations||evidence.notes||'Sin observaciones registradas');
 heading('Evidencia de ubicación');line('Coordenadas',`${number(evidence.latitude)}, ${number(evidence.longitude)}`);line('Precisión GPS',`${number(evidence.accuracy_meters)} m`);line('Distancia al destino',`${number(evidence.distance_meters)} m`);line('Registrado',dateTime(evidence.recorded_at||attempt.updated_at));
 heading('Productos entregados');for(const item of order.items||[]){if(y>270){pdf.addPage();y=18;}line(`${item.quantity} × ${item.product_name||'Producto'}`,money(item.subtotal,order.currency));}line('Total del pedido',money(order.total,order.currency));
 if(y>264){pdf.addPage();y=18;}y+=5;pdf.setTextColor(71,84,103);pdf.text(pdf.splitTextToSize('Documento operativo generado a partir de la evidencia registrada por Rutas. No sustituye una factura fiscal.',174),18,y);
 pdf.save(`comprobante-entrega-${filename(order.number)}.pdf`);
}

export default function DeliveryReceipt({order,attempt}){
 const [open,setOpen]=useState(false),[message,setMessage]=useState(''),[working,setWorking]=useState(false);
 if(!attempt||attempt.status!=='DELIVERED')return null;
 const evidence=attempt.evidence||{};
 async function download(){setWorking(true);setMessage('');try{await downloadPdf(order,attempt);setMessage('Comprobante PDF descargado.');}catch{setMessage('No se pudo generar el PDF. Inténtalo nuevamente.');}finally{setWorking(false);}}
 return <div className="delivery-receipt"><button type="button" className="od-button secondary" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>{open?'Ocultar comprobante':'Ver comprobante'}</button>{open?<div className="delivery-receipt-preview"><h3>Comprobante de entrega</h3><dl><div><dt>Pedido</dt><dd>{order.number}</dd></div><div><dt>Ruta</dt><dd>Ruta #{routeNumber(attempt.route_id)}</dd></div><div><dt>Parada</dt><dd>{attempt.stop_sequence??'No registrada'}</dd></div><div><dt>Entregado</dt><dd>{dateTime(attempt.updated_at)}</dd></div><div><dt>Repartidor</dt><dd>{attempt.driver_name||'No registrado'}</dd></div><div><dt>Observaciones</dt><dd>{evidence.observations||evidence.notes||'Sin observaciones registradas'}</dd></div></dl><button type="button" className="od-button primary" disabled={working} onClick={download}>{working?'Generando PDF…':'Descargar PDF'}</button><small role="status">{message}</small><p>No sustituye una factura fiscal.</p></div>:null}</div>;
}
