import React, {useState} from 'react';
import {dateTime, money} from './orderView.js';

const number=value=>value==null?'No registrado':new Intl.NumberFormat('es-VE',{maximumFractionDigits:4}).format(Number(value));
const routeNumber=id=>String(id||'').slice(-6).toUpperCase();
const filename=value=>String(value||'pedido').replace(/[^a-zA-Z0-9_-]/g,'');
const brandColor=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value:'#0758b3';

async function downloadPdf(order,attempt,companyProfile){
 const {jsPDF}=await import('jspdf'),pdf=new jsPDF({unit:'mm',format:'a4'}),evidence=attempt.evidence||{},customer=order.customer_snapshot||{},delivery=order.delivery_snapshot||{};
 const company=companyProfile?.name||'Empresa',color=brandColor(companyProfile?.primaryColor),initials=company.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();let y=50;
 const page=()=>{pdf.setFillColor(color);pdf.rect(0,0,210,34,'F');pdf.setFillColor('#ffffff');pdf.roundedRect(16,9,18,18,3,3,'F');pdf.setTextColor(color);pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.text(initials||'E',25,20,{align:'center'});pdf.setTextColor('#ffffff');pdf.setFontSize(15);pdf.text(company,40,17);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text('OPERACIONES · COMPROBANTE DE ENTREGA',40,23);pdf.setTextColor('#1f2937');};
 const newPage=()=>{pdf.addPage();page();y=50;};
 const ensure=height=>{if(y+height>278)newPage();};
 const line=(label,value)=>{const rows=pdf.splitTextToSize(String(value??'No registrado'),128);ensure(Math.max(7,rows.length*5));pdf.setTextColor('#667085');pdf.setFont('helvetica','normal');pdf.text(label.toUpperCase(),18,y);pdf.setTextColor('#24324a');pdf.setFont('helvetica','bold');pdf.text(rows,64,y);y+=Math.max(7,rows.length*5);};
 const heading=value=>{ensure(16);y+=4;pdf.setFillColor('#f2f6fb');pdf.roundedRect(16,y-6,178,11,2,2,'F');pdf.setTextColor(color);pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.text(value,20,y+1);pdf.setFontSize(9);y+=11;};
 pdf.setProperties({title:`Comprobante de entrega ${order.number}`,subject:'Evidencia operativa de entrega registrada por Rutas',creator:'MasterERP'});
 page();pdf.setFontSize(18);pdf.setFont('helvetica','bold');pdf.text('Comprobante de entrega',18,43);pdf.setFontSize(9);line('Pedido',order.number);line('Documento',`CE-${routeNumber(attempt.route_id)}-${attempt.stop_sequence??'S/N'}`);
 heading('Datos de la entrega');line('Resultado','Entregado');line('Fecha y hora',dateTime(attempt.updated_at));line('Ruta',`Ruta #${routeNumber(attempt.route_id)}`);line('Parada',attempt.stop_sequence??'No registrada');line('Repartidor',attempt.driver_name||'No registrado');line('Cliente',customer.name||'No registrado');line('Dirección',delivery.address||delivery.address_line_1||'No registrada');line('Observaciones',evidence.observations||evidence.notes||'Sin observaciones registradas');
 heading('Evidencia de ubicación');line('Coordenadas',`${number(evidence.latitude)}, ${number(evidence.longitude)}`);line('Precisión GPS',`${number(evidence.accuracy_meters)} m`);line('Distancia al destino',`${number(evidence.distance_meters)} m`);line('Registrado',dateTime(evidence.recorded_at||attempt.updated_at));
 heading('Productos entregados');for(const item of order.items||[])line(`${item.quantity} × ${item.product_name||'Producto'}`,money(item.subtotal,order.currency));ensure(15);pdf.setFillColor(color);pdf.roundedRect(116,y-2,78,12,2,2,'F');pdf.setTextColor('#ffffff');pdf.setFontSize(11);pdf.text(`TOTAL  ${money(order.total,order.currency)}`,190,y+6,{align:'right'});y+=18;
 ensure(20);pdf.setTextColor('#667085');pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text(pdf.splitTextToSize('Documento operativo generado a partir de la evidencia registrada por Rutas. No sustituye una factura fiscal.',174),18,y);const pages=pdf.getNumberOfPages();for(let index=1;index<=pages;index++){pdf.setPage(index);pdf.setDrawColor('#d8e0ea');pdf.line(16,287,194,287);pdf.setTextColor('#667085');pdf.text(`${company} · Generado por MasterERP`,16,292);pdf.text(`Página ${index} de ${pages}`,194,292,{align:'right'});}
 pdf.save(`comprobante-entrega-${filename(order.number)}.pdf`);
}

export default function DeliveryReceipt({order,attempt,companyProfile}){
 const [open,setOpen]=useState(false),[message,setMessage]=useState(''),[working,setWorking]=useState(false);
 if(!attempt||attempt.status!=='DELIVERED')return null;
 const evidence=attempt.evidence||{};
 async function download(){setWorking(true);setMessage('');try{await downloadPdf(order,attempt,companyProfile);setMessage('Comprobante PDF descargado.');}catch{setMessage('No se pudo generar el PDF. Inténtalo nuevamente.');}finally{setWorking(false);}}
 return <div className="delivery-receipt"><button type="button" className="od-button secondary" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>{open?'Ocultar comprobante':'Ver comprobante'}</button>{open?<div className="delivery-receipt-preview"><h3>Comprobante de entrega</h3><dl><div><dt>Pedido</dt><dd>{order.number}</dd></div><div><dt>Ruta</dt><dd>Ruta #{routeNumber(attempt.route_id)}</dd></div><div><dt>Parada</dt><dd>{attempt.stop_sequence??'No registrada'}</dd></div><div><dt>Entregado</dt><dd>{dateTime(attempt.updated_at)}</dd></div><div><dt>Repartidor</dt><dd>{attempt.driver_name||'No registrado'}</dd></div><div><dt>Observaciones</dt><dd>{evidence.observations||evidence.notes||'Sin observaciones registradas'}</dd></div></dl><button type="button" className="od-button primary" disabled={working} onClick={download}>{working?'Generando PDF…':'Descargar PDF'}</button><small role="status">{message}</small><p>No sustituye una factura fiscal.</p></div>:null}</div>;
}
