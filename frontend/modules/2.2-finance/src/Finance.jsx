import React from 'react';
import Parties from '../2.2.1-administration/screens/parties/Parties.jsx';
export default function Finance({workspace,path,navigate}) {
  const allowed=workspace.context?.modules.includes('erp.finance')&&workspace.context?.permissions.includes('administration.parties.read');
  if(!allowed)return <div className="notice" role="alert">No tienes acceso a Finanzas en este espacio.</div>;
  if(!workspace.context.companies.length)return <p className="notice" role="status">No hay empresas activas autorizadas para este módulo.</p>;
  if(!workspace.company)return <div className="notice" role="status">Selecciona una empresa para trabajar con Finanzas.</div>;
  const match=path.match(/^\/modulos\/finanzas\/administracion\/(clientes|proveedores)(?:\/.*)?$/);
  if(match)return <Parties key={workspace.tenant+':'+workspace.company+':'+match[1]+':'+path} workspace={workspace} capacity={match[1]} path={path} navigate={navigate}/>;
  return <section><p className="eyebrow">Módulo habilitado</p><h1>Finanzas</h1><p>Administración, Contabilidad y BI, dentro de tu espacio de trabajo.</p><h2>Administración</h2><div className="cards">
    <a className="panel module-card" href="#/modulos/finanzas/administracion/clientes"><span>01</span><h3>Clientes</h3><p>Consulta y administra terceros por empresa.</p></a>
    <a className="panel module-card" href="#/modulos/finanzas/administracion/proveedores"><span>02</span><h3>Proveedores</h3><p>Reutiliza el maestro de terceros y sus roles.</p></a></div>
    <h2>Próximas capacidades</h2><div className="cards">{['Contabilidad','BI','Compras, cartera y tesorería','Gastos y fondos menores','MasterPay'].map(name=><div className="panel" key={name}><h3>{name}</h3><span className="badge">Pendiente de implementación</span></div>)}</div></section>;
}
