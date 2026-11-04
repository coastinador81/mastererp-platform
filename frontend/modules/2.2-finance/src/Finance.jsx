import React from 'react';
import Parties from '../2.2.1-administration/screens/parties/Parties.jsx';
export default function Finance({workspace,path,navigate}) {
  const allowed=workspace.context?.modules.includes('erp.finance')&&workspace.context?.permissions.includes('administration.parties.read');
  if(!allowed)return <div className="notice" role="alert">No tienes acceso a Finanzas en este espacio.</div>;
  if(!workspace.context.companies.length)return <p className="notice" role="status">No hay empresas activas autorizadas para este módulo.</p>;
  if(!workspace.company)return <div className="notice" role="status">Selecciona una empresa para trabajar con Finanzas.</div>;
  const match=path.match(/^\/modulos\/finanzas\/administracion\/(clientes|proveedores)(?:\/.*)?$/);
  if(match)return <Parties key={workspace.tenant+':'+workspace.company+':'+match[1]+':'+path} workspace={workspace} capacity={match[1]} path={path} navigate={navigate}/>;
  return <section><p className="eyebrow">Módulo habilitado</p><h1>Finanzas</h1><p>Administración financiera de tu empresa.</p><h2>Administración</h2><div className="cards">
    <a className="panel module-card" href="#/modulos/finanzas/administracion/clientes"><h3>Clientes</h3><p>Consulta y administra terceros por empresa.</p></a>
    <a className="panel module-card" href="#/modulos/finanzas/administracion/proveedores"><h3>Proveedores</h3><p>Reutiliza el maestro de terceros y sus roles.</p></a></div>
    </section>;
}
