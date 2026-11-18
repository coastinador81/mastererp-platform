import React from 'react';
import PurchaseOrders from '../2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/PurchaseOrders.jsx';
import Purchases from '../2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/Purchases.jsx';
import Parties from '../2.2.1-administration/screens/parties/Parties.jsx';
import Sales from '../2.2.1-administration/2.2.1.1-gestion-comercial/2.2.1.1.3-ventas/screens/list/Sales.jsx';
import PaymentReviews from '../2.2.1-administration/2.2.1.4-tesoreria/2.2.1.4.1-cobros/PaymentReviews.jsx';
import PaymentDetail from '../2.2.1-administration/2.2.1.4-tesoreria/2.2.1.4.1-cobros/PaymentDetail.jsx';
export default function Finance({workspace,path,navigate}) {
  const allowed=workspace.context?.modules.includes('erp.finance')&&workspace.context?.permissions.some(p=>['administration.parties.read','administration.purchases.read','administration.read'].includes(p));
  if(!allowed)return <div className="notice" role="alert">No tienes acceso a Finanzas en este espacio.</div>;
  if(!workspace.context.companies.length)return <p className="notice" role="status">No hay empresas activas autorizadas para este módulo.</p>;
  if(!workspace.company)return <div className="notice" role="status">Selecciona una empresa para trabajar con Finanzas.</div>;
  if(/^\/modulos\/finanzas\/administracion\/ventas(?:\/.*)?$/.test(path))return <Sales key={workspace.tenant+':'+workspace.company+':'+path} workspace={workspace} path={path} navigate={navigate}/>;
  if(path==='/modulos/finanzas/administracion/cobros')return <PaymentReviews key={workspace.tenant+':'+workspace.company} workspace={workspace} navigate={navigate}/>;
  const payment=path.match(/^\/modulos\/finanzas\/administracion\/cobros\/([0-9a-f-]{36})$/i);
  if(payment)return <PaymentDetail key={workspace.tenant+':'+workspace.company+':'+payment[1]} workspace={workspace} orderId={payment[1]} navigate={navigate}/>;
  const buying=path.match(/^\/modulos\/finanzas\/administracion\/(solicitudes-compra|ordenes-compra|facturas-proveedores)(?:\/.*)?$/);
  if(buying?.[1]==='ordenes-compra')return <PurchaseOrders key={workspace.tenant+':'+workspace.company+':'+path} workspace={workspace} path={path} navigate={navigate}/>;
  if(buying)return <Purchases key={workspace.tenant+':'+workspace.company+':'+path} workspace={workspace} capacity={buying[1]} path={path} navigate={navigate}/>;
  const match=path.match(/^\/modulos\/finanzas\/administracion\/(clientes|proveedores)(?:\/.*)?$/);
  if(match)return <Parties key={workspace.tenant+':'+workspace.company+':'+match[1]+':'+path} workspace={workspace} capacity={match[1]} path={path} navigate={navigate}/>;
  return <section><p className="eyebrow">Módulo habilitado</p><h1>Finanzas</h1><p>Administración financiera de tu empresa.</p><h2>Administración</h2><div className="cards">
    {workspace.context.permissions.includes('administration.parties.read')&&<><a className="panel module-card" href="#/modulos/finanzas/administracion/clientes"><h3>Clientes</h3><p>Consulta y administra terceros por empresa.</p></a>
    <a className="panel module-card" href="#/modulos/finanzas/administracion/proveedores"><h3>Proveedores</h3><p>Reutiliza el maestro de terceros y sus roles.</p></a></>}{workspace.context.permissions.includes('administration.read')&&<a className="panel module-card" href="#/modulos/finanzas/administracion/ventas"><h3>Ventas</h3><p>Consulta ventas registradas y sus pedidos de origen.</p></a>}</div>
    </section>;
}
