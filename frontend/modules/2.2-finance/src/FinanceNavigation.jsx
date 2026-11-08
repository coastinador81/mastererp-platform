import React,{useEffect} from 'react';
import FinanceIcon from './FinanceIcon.jsx';
import {ChevronDownIcon} from '../../0-uonify/components/ShellIcons.tsx';
const itemIcons={clientes:'clients',proveedores:'supplier',
 'Sugerencias de compras':'summary','Resumen':'summary','Compras':'document','Órdenes de compra':'order','Facturas de proveedores':'invoice',
 Cotizaciones:'quote',Ventas:'sales',Facturación:'document'};
const groups = [
  ['2.2.1.1', 'Gestión comercial', [['Clientes','clientes'],['Cotizaciones'],['Ventas','ventas'],['Facturación']]],
  ['2.2.1.2', 'Gestión de compras', [['Proveedores','proveedores'],['Compras','solicitudes-compra'],['Órdenes de compra','ordenes-compra'],['Facturas de proveedores','facturas-proveedores']]],
  ['2.2.1.3', 'Cartera y obligaciones', [['Cuentas por cobrar'],['Cuentas por pagar']]],
  ['2.2.1.4', 'Tesorería', [['Cobros'],['Pagos'],['Caja'],['Bancos'],['Transferencias'],['Conciliación']]],
  ['2.2.1.5', 'Gastos y fondos menores', [['Gastos operativos'],['Caja chica'],['Anticipos y rendiciones']]],
];
export default function FinanceNavigation({allowed,path,navigate,permissions=[],previewOnly=false,onClose}) {
  useEffect(()=>{const close=e=>{if(e.key==='Escape'&&!e.defaultPrevented&&document.querySelector('.finance-app .integrated-nav:is(.is-open,:focus-within)')){onClose?.();document.querySelector('.finance-app .menu-toggle')?.focus();}};const media=matchMedia('(max-width:800px)');const reset=()=>onClose?.();document.addEventListener('keydown',close);media.addEventListener('change',reset);return()=>{document.removeEventListener('keydown',close);media.removeEventListener('change',reset);};},[onClose]);
  const canOpen=route=>previewOnly?['resumen-compras','solicitudes-compra','sugerencias-compras','ordenes-compra'].includes(route):allowed&&permissions.includes(route==='ventas'?'administration.read':['clientes','proveedores'].includes(route)?'administration.parties.read':'administration.purchases.read');
  return <nav className="finance-navigation" aria-label="Administración">
    <p className="nav-caption">FINANZAS</p>
    {allowed ? <a href="/" title="Resumen" aria-current={path==='/modulos/finanzas'?'page':undefined}><FinanceIcon name="summary"/><span className="finance-nav-label">Resumen</span></a> : null}
    <details className="administration-nav" open><summary className="administration-nav-title" title="Administración"><FinanceIcon name="document"/><span className="finance-nav-label">Administración</span><ChevronDownIcon className="finance-disclosure-icon"/></summary><div className="administration-nav-children">
    {groups.map(([number,name,groupItems],index)=>{const items=previewOnly&&number==='2.2.1.2'?[['Resumen','resumen-compras'],...groupItems.flatMap(item=>item[1]==='solicitudes-compra'?[item,['Sugerencias de compras','sugerencias-compras']]:[item])]:groupItems;return <details className="finance-nav-group" key={number} open={index<2||items.some(([,route])=>route&&path.includes('/'+route))}>
      <summary title={name}><FinanceIcon name={['sales','order','invoice','summary','document'][index]}/><span className="finance-nav-label">{name}</span><ChevronDownIcon className="finance-disclosure-icon"/></summary>
      <ul>{items.map(([label,route])=><li key={label}>{route&&canOpen(route)?
        <a className="subnav" href={'/?'+(previewOnly?'demo=compras&':'')+'vista='+route} onClick={e=>{if(navigate&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();navigate('/modulos/finanzas/administracion/'+route);}}} aria-current={path.includes('/administracion/'+route)?'page':undefined}><FinanceIcon name={itemIcons[route]||itemIcons[label]||'document'}/><span>{label}</span></a>:
        <span className="finance-nav-pending" aria-disabled="true"><FinanceIcon name={itemIcons[route]||itemIcons[label]||'document'}/><span>{label}</span><small>{previewOnly?'Vista previa':route?'Sin acceso':'Pendiente'}</small></span>}</li>)}</ul>
    </details>;})}
    </div></details>
  </nav>;
}
