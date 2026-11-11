import React,{useEffect,useMemo,useRef,useState}from'react';
import {config,useWorkspace}from'../../../app-shell/src/session.jsx';
import ApplicationHeader from'../../../shared/ui/ApplicationHeader.jsx';
import RelatedServicesRail from'../../../shared/module-launcher/RelatedServicesRail.jsx';
import Drivers from'../2.10.1-drivers/src/Drivers.jsx';
import Routes from'../2.10.5-routes/src/Routes.jsx';
import DriverRoute from'./DriverRoute.jsx';
import TransportNavigation from'./TransportNavigation.jsx';
const valid=new Set(['my-route','drivers','routes']);
const current=()=>{const value=location.hash.replace(/^#\/?/,'').split('/')[0];return valid.has(value)?value:'my-route';};
export default function TransportApp(){
 const workspace=useWorkspace(),[route,setRoute]=useState(current),[menu,setMenu]=useState(false),menuTrigger=useRef(null);
 useEffect(()=>{const change=()=>{setRoute(current());setMenu(false);};addEventListener('hashchange',change);return()=>removeEventListener('hashchange',change);},[]);
 const permissions=workspace.context?.permissions||[],runtime=useMemo(()=>({api:config.adminApiUrl,tenant:workspace.tenant,company:workspace.company,permissions,request:workspace.request}),[workspace.tenant,workspace.company,permissions,workspace.request]);
 const navigate=value=>{location.hash=`/${value}`;};let content;
 if(!workspace.signedIn)content=<section className="transport-welcome"><p className="eyebrow">REPARTIDORES</p><h1>Gestiona rutas y entregas.</h1><p>Accede con tu cuenta Uonify para continuar.</p><button className="primary" disabled={workspace.authenticating} onClick={workspace.startLogin}>Acceder</button></section>;
 else if(workspace.loading)content=<p role="status">Preparando tu espacio de trabajo…</p>;
 else if(!workspace.tenant||!workspace.company)content=<div className="notice">Selecciona un espacio y una empresa para continuar.</div>;
 else if(!workspace.context?.modules.includes('erp.transport'))content=<div className="notice error">Repartidores no está habilitado para este espacio.</div>;
 else if(route==='my-route'&&permissions.includes('transport.deliveries.execute'))content=<DriverRoute runtime={runtime}/>;
 else if(route==='drivers'&&permissions.includes('transport.drivers.read'))content=<Drivers runtime={runtime}/>;
 else if(route==='routes'&&permissions.includes('operations.routes.read'))content=<Routes runtime={runtime}/>;
 else content=<div className="notice error">No tienes permiso para consultar esta capacidad.</div>;
 return <div className="integrated-app ecommerce-app transport-app"><a className="skip-link" href="#content">Saltar al contenido</a><ApplicationHeader workspace={workspace} currentApp="transport" brand="Repartidores" brandHref="#/my-route" menuOpen={menu} onToggleMenu={()=>setMenu(!menu)} menuTrigger={menuTrigger}/><div className="integrated-layout"><div className="finance-service-rail"><RelatedServicesRail currentApp="transport" services={['uonify','transport','ecommerce','inventory','finance']}/></div><aside id="transport-navigation" className={`integrated-nav ${menu?'is-open':''}`}><TransportNavigation permissions={permissions} route={route} navigate={navigate}/></aside><main id="content" className="integrated-content" tabIndex={-1}><p className="environment">Uonify Transporte · Entorno de desarrollo</p>{workspace.error?<div className="notice error">{workspace.error}</div>:null}{content}</main></div></div>;
}
