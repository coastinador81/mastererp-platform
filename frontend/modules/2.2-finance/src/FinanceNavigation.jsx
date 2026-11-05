import React from 'react';
import {ChevronDownIcon} from '../../0-uonify/components/ShellIcons.tsx';
const groups = [
  ['2.2.1.1', 'Gestión comercial', [['Clientes','clientes'],['Cotizaciones'],['Ventas'],['Facturación']]],
  ['2.2.1.2', 'Gestión de compras', [['Proveedores','proveedores'],['Solicitudes de compra','solicitudes-compra'],['Órdenes de compra','ordenes-compra'],['Facturas de proveedores','facturas-proveedores']]],
  ['2.2.1.3', 'Cartera y obligaciones', [['Cuentas por cobrar'],['Cuentas por pagar']]],
  ['2.2.1.4', 'Tesorería', [['Cobros'],['Pagos'],['Caja'],['Bancos'],['Transferencias'],['Conciliación']]],
  ['2.2.1.5', 'Gastos y fondos menores', [['Gastos operativos'],['Caja chica'],['Anticipos y rendiciones']]],
];
export default function FinanceNavigation({allowed,path,navigate}) {
  return <nav className="finance-navigation" aria-label="Administración">
    <p className="nav-caption">FINANZAS</p>
    {allowed ? <a href="/" aria-current={path==='/modulos/finanzas'?'page':undefined}>Resumen de Finanzas</a> : null}
    <details className="administration-nav" open><summary className="administration-nav-title"><ChevronDownIcon className="finance-disclosure-icon"/>Administración</summary><div className="administration-nav-children">
    {groups.map(([number,name,items],index)=><details className="finance-nav-group" key={number} open={index<2||items.some(([,route])=>route&&path.includes('/'+route))}>
      <summary><ChevronDownIcon className="finance-disclosure-icon"/>{name}</summary>
      <ul>{items.map(([label,route])=><li key={label}>{route?
        <a className="subnav" href={'/?vista='+route} onClick={e=>{if(navigate&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();navigate('/modulos/finanzas/administracion/'+route);}}} aria-current={path.includes('/administracion/'+route)?'page':undefined}>{label}</a>:
        <span className="finance-nav-pending" aria-disabled="true">{label}{!route&&<small>Pendiente</small>}</span>}</li>)}</ul>
    </details>)}
    </div></details>
  </nav>;
}
