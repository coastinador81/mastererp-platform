const safeFilename=value=>String(value||'pedido').replace(/[^a-zA-Z0-9_-]/g,'');
const brandColor=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value:'#0758b3';

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

