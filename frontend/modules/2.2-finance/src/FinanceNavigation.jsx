import React from 'react';
const groups = [
  ['2.2.1.1', 'Gestión comercial', [['Clientes','clientes'],['Cotizaciones'],['Ventas'],['Facturación']]],
  ['2.2.1.2', 'Gestión de compras', [['Proveedores','proveedores'],['Solicitudes de compra'],['Órdenes de compra'],['Facturas de proveedores']]],
  ['2.2.1.3', 'Cartera y obligaciones', [['Cuentas por cobrar'],['Cuentas por pagar']]],
  ['2.2.1.4', 'Tesorería', [['Cobros'],['Pagos'],['Caja'],['Bancos'],['Transferencias'],['Conciliación']]],
  ['2.2.1.5', 'Gastos y fondos menores', [['Gastos operativos'],['Caja chica'],['Anticipos y rendiciones']]],
];
export default function FinanceNavigation({allowed,path}) {
  return <nav className="finance-navigation" aria-label="Administración">
    <p className="nav-caption">FINANZAS</p>
    {allowed ? <a href="/" aria-current={path==='/modulos/finanzas'?'page':undefined}>Resumen de Finanzas</a> : null}
    <details className="administration-nav" open><summary className="administration-nav-title">Administración</summary><div className="administration-nav-children">
    {groups.map(([number,name,items],index)=><details className="finance-nav-group" key={number} open={index<2||items.some(([,route])=>route&&path.includes('/'+route))}>
      <summary>{name}</summary>
      <ul>{items.map(([label,route])=><li key={label}>{route==='proveedores'?
        <a className="subnav" href="/?vista=proveedores" aria-current={new URLSearchParams(window.location.search).get('vista')==='proveedores'?'page':undefined}>{label}</a>:
        route&&allowed?<a className="subnav" href={'#/modulos/finanzas/administracion/'+route} aria-current={path.startsWith('/modulos/finanzas/administracion/'+route)?'page':undefined}>{label}</a>:
        <span className="finance-nav-pending" aria-disabled="true">{label}{!route&&<small>Pendiente</small>}</span>}</li>)}</ul>
    </details>)}
    </div></details>
  </nav>;
}
