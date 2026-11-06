import React,{useEffect,useRef} from 'react';
import './supplierWizard.css';

const steps=[
 ['Identidad del proveedor','Indica su código interno, nombre y datos fiscales. Solo código y nombre son obligatorios.'],
 ['Dirección y contactos','Añade los datos de comunicación que tengas. Puedes continuar sin contactos ni principal.'],
 ['Condiciones y revisión','Completa las preferencias de la empresa activa y revisa antes de crear.'],
];

export default function SupplierWizardHeader({step}){
 const heading=useRef(null);
 const labels=['Datos básicos','Dirección y contactos','Condiciones'];
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[step]);
 return <header className="supplier-wizard-header">
  <ol aria-label="Pasos para crear proveedor">{steps.map(([title],index)=><li key={title} aria-current={index===step?'step':undefined} aria-label={'Paso '+(index+1)+': '+title} className={index===step?'current':index<step?'complete':''}>
   <span className="supplier-wizard-number" aria-hidden="true">{index<step?'✓':index+1}</span><span>{labels[index]}</span>
  </li>)}</ol>
  <p className="supplier-wizard-progress" role="status">Paso {step+1} de 3</p>
  <h2 ref={heading} tabIndex={-1}>{steps[step][0]}</h2>
  <p>{steps[step][1]}</p>
 </header>;
}
