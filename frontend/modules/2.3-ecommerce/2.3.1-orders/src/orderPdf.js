const safeFilename=value=>String(value||'pedido').replace(/[^a-zA-Z0-9_-]/g,'');
const brandColor=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value:'#0758b3';
const value=(source,...keys)=>keys.map(key=>source?.[key]).find(item=>item!=null&&item!=='');
const invoiceMoney=(amount,currency)=>new Intl.NumberFormat('es-VE',{style:'currency',currency:currency||'USD'}).format(Number(amount||0));
const invoiceDate=date=>date?new Intl.DateTimeFormat('es-VE',{dateStyle:'short'}).format(new Date(date)):'No registrada';

async function logoData(companyProfile){
  const source=value(companyProfile,'logoUrl','logo_url','logo');
  if(!source)return null;
  try{
    const response=await fetch(source);if(!response.ok)return null;
    const blob=await response.blob();
    return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve(null);reader.readAsDataURL(blob);});
  }catch{return null;}
}

export async function createOrderPdf({companyProfile,title,kicker,metadata={}}){
  const {jsPDF}=await import('jspdf');
  const pdf=new jsPDF({unit:'mm',format:'a4'});
  const company=companyProfile?.name||'Empresa';
  const color=brandColor(companyProfile?.primaryColor);
  const initials=company.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();
  let y=50;

  const header=()=>{
    pdf.setFillColor(color);pdf.rect(0,0,210,34,'F');
    pdf.setFillColor('#ffffff');pdf.roundedRect(16,9,18,18,3,3,'F');
    pdf.setTextColor(color);pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.text(initials||'E',25,20,{align:'center'});
    pdf.setTextColor('#ffffff');pdf.setFontSize(15);pdf.text(company,40,17);
    pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.text(kicker,40,23);
    pdf.setTextColor('#1f2937');
  };
  const nextPage=()=>{pdf.addPage();header();y=50;};
  const ensure=height=>{if(y+height>278)nextPage();};
  const line=(label,value)=>{
    const rows=pdf.splitTextToSize(String(value??'No registrado'),128);
    ensure(Math.max(7,rows.length*5));
    pdf.setFontSize(9);pdf.setTextColor('#667085');pdf.setFont('helvetica','normal');pdf.text(label.toUpperCase(),18,y);
    pdf.setTextColor('#24324a');pdf.setFont('helvetica','bold');pdf.text(rows,64,y);
    y+=Math.max(7,rows.length*5);
  };
  const heading=value=>{
    ensure(16);y+=4;pdf.setFillColor('#f2f6fb');pdf.roundedRect(16,y-6,178,11,2,2,'F');
    pdf.setTextColor(color);pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.text(value,20,y+1);pdf.setFontSize(9);y+=11;
  };
  const total=value=>{
    ensure(15);pdf.setFillColor(color);pdf.roundedRect(116,y-2,78,12,2,2,'F');
    pdf.setTextColor('#ffffff');pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.text(value,190,y+6,{align:'right'});y+=18;
  };
  const note=value=>{
    ensure(20);pdf.setTextColor('#667085');pdf.setFont('helvetica','normal');pdf.setFontSize(8);
    pdf.text(pdf.splitTextToSize(value,174),18,y);y+=12;
  };
  const finish=filename=>{
    const pages=pdf.getNumberOfPages();
    for(let index=1;index<=pages;index++){
      pdf.setPage(index);pdf.setDrawColor('#d8e0ea');pdf.line(16,287,194,287);pdf.setTextColor('#667085');pdf.setFontSize(8);
      pdf.text(`${company} · Generado por MasterERP`,16,292);pdf.text(`Página ${index} de ${pages}`,194,292,{align:'right'});
    }
    pdf.save(`${safeFilename(filename)}.pdf`);
  };

  pdf.setProperties({title,creator:'MasterERP',...metadata});
  header();pdf.setFontSize(18);pdf.setFont('helvetica','bold');pdf.text(title,18,43);pdf.setFontSize(9);
  return {pdf,line,heading,total,note,finish};
}

export async function createInvoicePdf({order,companyProfile}){
  const {jsPDF}=await import('jspdf'),pdf=new jsPDF({unit:'mm',format:'a4'});
  const company=value(companyProfile,'legalName','legal_name','name')||'Empresa';
  const color=brandColor(value(companyProfile,'primaryColor','primary_color'));
  const taxId=value(companyProfile,'taxId','tax_id','rif','document','numero_identificacion');
  const address=value(companyProfile,'fiscalAddress','fiscal_address','address','direccion_fiscal');
  const phone=value(companyProfile,'phone','telefono'),email=value(companyProfile,'email','correo');
  const customer=order.customer_snapshot||{},payment=order.payment_snapshot||{};
  const logo=await logoData(companyProfile),margin=16,right=194;
  let y=18;
  pdf.setProperties({title:`Factura ${order.number}`,subject:`Detalle del pedido ${order.number}`,creator:'MasterERP'});

  if(logo){try{pdf.addImage(logo,margin,y-4,34,18,undefined,'FAST');}catch{/* Use the company name when the configured image is not compatible. */}}
  const nameX=logo?54:margin;
  pdf.setTextColor(color);pdf.setFont('helvetica','bold');pdf.setFontSize(22);pdf.text(company,nameX,y+5);
  pdf.setDrawColor(color);pdf.setLineWidth(.7);pdf.line(margin,y+11,right,y+11);
  pdf.setTextColor('#28323f');pdf.setFont('helvetica','normal');pdf.setFontSize(8.5);y+=17;
  [address,taxId&&`RIF: ${taxId}`,[phone,email].filter(Boolean).join(' · ')].filter(Boolean).forEach(line=>{pdf.text(pdf.splitTextToSize(String(line),82),margin,y);y+=5;});

  const customerX=112,customerY=39;
  pdf.setFont('helvetica','bold');pdf.setTextColor(color);pdf.text('FACTURAR A',customerX,customerY);
  pdf.setTextColor('#28323f');pdf.setFont('helvetica','normal');
  [value(customer,'name','nombre')||'Cliente no registrado',value(customer,'document','tax_id','numero_identificacion'),value(customer,'email','correo'),value(customer,'phone','telefono')].filter(Boolean).forEach((line,index)=>pdf.text(String(line),customerX,customerY+6+(index*5)));

  y=Math.max(y+13,72);pdf.setTextColor(color);pdf.setFont('helvetica','normal');pdf.setFontSize(20);pdf.text(`Factura ${order.number}`,margin,y);y+=11;
  const facts=[['Fecha de factura',invoiceDate(order.created_at)],['Referencia',order.number],['Moneda',order.currency||'USD'],['Estado del pago',payment.status||'Pendiente']];
  const factWidth=44.5;
  facts.forEach(([label,detail],index)=>{const x=margin+(index*factWidth);pdf.setFont('helvetica','bold');pdf.setFontSize(8);pdf.setTextColor(color);pdf.text(label,x,y);pdf.setFont('helvetica','normal');pdf.setTextColor('#28323f');pdf.text(pdf.splitTextToSize(String(detail),factWidth-3),x,y+5);});
  y+=17;

  const columns=[{label:'Descripción',x:margin,w:83,align:'left'},{label:'Cantidad',x:99,w:20,align:'right'},{label:'Precio unitario',x:121,w:28,align:'right'},{label:'Impuestos',x:151,w:18,align:'right'},{label:'Importe',x:171,w:23,align:'right'}];
  const tableHeader=()=>{pdf.setFillColor(color);pdf.rect(margin,y,right-margin,9,'F');pdf.setTextColor('#ffffff');pdf.setFont('helvetica','bold');pdf.setFontSize(8);columns.forEach(column=>pdf.text(column.label,column.align==='right'?column.x+column.w:column.x+2,y+6,{align:column.align}));y+=12;};
  const page=()=>{pdf.addPage();y=18;pdf.setTextColor(color);pdf.setFont('helvetica','bold');pdf.setFontSize(12);pdf.text(`${company} · Factura ${order.number}`,margin,y);pdf.setDrawColor(color);pdf.line(margin,y+4,right,y+4);y+=11;tableHeader();};
  tableHeader();
  (order.items||[]).forEach(item=>{
    const description=pdf.splitTextToSize(String(item.product_name||item.name||'Producto'),78),height=Math.max(10,description.length*4.5+4);
    if(y+height>258)page();
    pdf.setTextColor('#28323f');pdf.setFont('helvetica','normal');pdf.setFontSize(8.5);pdf.text(description,margin+2,y+4);
    pdf.text(String(item.quantity??0),119,y+4,{align:'right'});pdf.text(invoiceMoney(item.unit_price,order.currency),149,y+4,{align:'right'});pdf.text('—',169,y+4,{align:'right'});pdf.text(invoiceMoney(item.subtotal,order.currency),right,y+4,{align:'right'});
    pdf.setDrawColor('#e2e6ea');pdf.line(margin,y+height,right,y+height);y+=height;
  });
  y+=5;if(y>226)page();
  const totalsX=126;
  [['Subtotal',invoiceMoney(order.subtotal,order.currency)],['Entrega',invoiceMoney(order.delivery_fee,order.currency)]].forEach(([label,amount])=>{pdf.setFont('helvetica','normal');pdf.setTextColor('#4b5563');pdf.text(label,totalsX,y);pdf.text(amount,right,y,{align:'right'});y+=7;});
  pdf.setDrawColor(color);pdf.setLineWidth(.5);pdf.line(totalsX,y-3,right,y-3);pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.setTextColor(color);pdf.text('Total',totalsX,y+3);pdf.setTextColor('#202833');pdf.text(invoiceMoney(order.total,order.currency),right,y+3,{align:'right'});y+=15;

  pdf.setFontSize(8.5);pdf.setFont('helvetica','bold');pdf.setTextColor(color);pdf.text('Información de pago',margin,y);
  pdf.setFont('helvetica','normal');pdf.setTextColor('#28323f');y+=5;
  const paymentLines=[payment.method&&`Método: ${payment.method}`,payment.reference&&`Referencia: ${payment.reference}`].filter(Boolean);
  pdf.text(paymentLines.length?paymentLines:'Sin información de pago registrada',margin,y);
  y+=12;pdf.setTextColor('#6b7280');pdf.setFontSize(8);pdf.text(pdf.splitTextToSize('Documento generado desde los datos del pedido. La validez fiscal depende de la factura o nota de crédito emitida y vinculada por Finanzas.',178),margin,y);

  const pages=pdf.getNumberOfPages();for(let index=1;index<=pages;index++){pdf.setPage(index);pdf.setDrawColor('#cfd5dc');pdf.line(margin,282,right,282);pdf.setFontSize(8);pdf.setTextColor('#6b7280');pdf.text(`${company} · Generado por MasterERP`,margin,288);pdf.text(`Página ${index} / ${pages}`,right,288,{align:'right'});}
  pdf.save(`${safeFilename(`factura-${order.number}`)}.pdf`);
}
