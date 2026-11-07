import React from 'react';
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
export default function FinanceNavigation({allowed,path,navigate,permissions=[],previewOnly=false}) {
  const canOpen=route=>previewOnly?['resumen-compras','solicitudes-compra','sugerencias-compras','ordenes-compra'].includes(route):allowed&&permissions.includes(route==='ventas'?'administration.read':['clientes','proveedores'].includes(route)?'administration.parties.read':'administration.purchases.read');
  return <nav className="finance-navigation" aria-label="Administración">
    <p className="nav-caption">FINANZAS</p>
    {allowed ? <a href="/" aria-current={path==='/modulos/finanzas'?'page':undefined}><FinanceIcon name="summary"/>Resumen de Finanzas</a> : null}
    <details className="administration-nav" open><summary className="administration-nav-title"><ChevronDownIcon className="finance-disclosure-icon"/>Administración</summary><div className="administration-nav-children">
    {groups.map(([number,name,groupItems],index)=>{const items=previewOnly&&number==='2.2.1.2'?[['Resumen','resumen-compras'],...groupItems.flatMap(item=>item[1]==='solicitudes-compra'?[item,['Sugerencias de compras','sugerencias-compras']]:[item])]:groupItems;return <details className="finance-nav-group" key={number} open={index<2||items.some(([,route])=>route&&path.includes('/'+route))}>
      <summary><ChevronDownIcon className="finance-disclosure-icon"/>{name}</summary>
      <ul>{items.map(([label,route])=><li key={label}>{route&&canOpen(route)?
        <a className="subnav" href={'/?vista='+route} onClick={e=>{if(navigate&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();navigate('/modulos/finanzas/administracion/'+route);}}} aria-current={path.includes('/administracion/'+route)?'page':undefined}><FinanceIcon name={itemIcons[route]||itemIcons[label]||'document'}/><span>{label}</span></a>:
        <span className="finance-nav-pending" aria-disabled="true"><FinanceIcon name={itemIcons[route]||itemIcons[label]||'document'}/><span>{label}</span><small>{previewOnly?'Vista previa':route?'Sin acceso':'Pendiente'}</small></span>}</li>)}</ul>
    </details>;})}
    </div></details>
  </nav>;
}
