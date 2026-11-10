import React, {useEffect, useMemo, useRef, useState} from 'react';
import {config, useWorkspace} from '../../../app-shell/src/session.jsx';
import Orders from '../2.3.1-orders/src/Orders.jsx';
import Preparation from '../../2.1-inventory/2.1.3-preparation/src/Preparation.jsx';
import Routes from '../../2.10-transport/2.10.5-routes/src/Routes.jsx';
import Drivers from '../../2.10-transport/2.10.1-drivers/src/Drivers.jsx';
import Nodes from '../../2.1-inventory/2.1.2-nodes/src/Nodes.jsx';
import Products from '../2.3.4-catalog/2.3.4.1-products/src/Products.jsx';
import Categories from '../2.3.4-catalog/2.3.4.2-categories/src/Categories.jsx';
import Attributes from '../2.3.4-catalog/2.3.4.3-attributes/src/Attributes.jsx';
import Brands from '../2.3.4-catalog/2.3.4.4-brands/src/Brands.jsx';
import Suppliers from '../2.3.4-catalog/2.3.4.5-suppliers/src/Suppliers.jsx';
import Inventory from '../../2.1-inventory/2.1.1-inventory/src/Inventory.jsx';
import PaymentConfiguration from '../2.3.2-stores/src/PaymentConfiguration.jsx';
import CommerceHeaderMenus from './CommerceHeaderMenus.jsx';
import OperationsNavigation from './OperationsNavigation.jsx';
import EcommerceSummary from './EcommerceSummary.jsx';
import {canOpenOperationsRoute, operationsModule} from './access.mjs';
import RelatedServicesRail from '../../../shared/module-launcher/RelatedServicesRail.jsx';
import {FinanceAssistantProvider,FinanceAssistantToggle,FinanceAssistantPanel} from '../../2.2-finance/src/FinanceAssistant.jsx';
import ModuleLauncher from '../../../shared/module-launcher/ModuleLauncher.jsx';

const routeLabels={summary:'Resumen de Ecommerce',orders:'Pedidos',payments:'Métodos de pago',preparation:'Preparacion',routes:'Rutas',drivers:'Repartidores',nodes:'Nodos',products:'Productos',categories:'Categorias',attributes:'Atributos',brands:'Marcas',suppliers:'Proveedores',inventory:'Inventario'};
const routes = new Set(['summary','orders','payments','preparation','routes','drivers','nodes','products','categories','attributes','brands','suppliers','inventory']);
const currentPath = () => {
  const value = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes.has(value.split('/')[0]) ? value : 'summary';
};

export default function EcommerceApp() {
  const workspace = useWorkspace();
  const [path, setPath] = useState(currentPath), [menu, setMenu] = useState(false);
  const route=path.split('/')[0];
  const menuTrigger=useRef(null);
  useEffect(()=>{const key=e=>{if(e.key==='Escape'&&!e.defaultPrevented&&document.querySelector('.ecommerce-app .integrated-nav:is(.is-open,:focus-within)')){setMenu(false);menuTrigger.current?.focus();}};const media=matchMedia('(max-width:800px)');const reset=()=>setMenu(false);document.addEventListener('keydown',key);media.addEventListener('change',reset);return()=>{document.removeEventListener('keydown',key);media.removeEventListener('change',reset);};},[]);
  useEffect(() => {const change = () => {setPath(currentPath()); setMenu(false);}; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);}, []);
  const permissions = workspace.context?.permissions || [];
  const enabled = workspace.context?.modules.some(module=>[operationsModule,'erp.catalog'].includes(module));
  const runtime = useMemo(() => ({api: config.adminApiUrl, tenant: workspace.tenant, company: workspace.company, permissions, request: workspace.request}), [workspace.tenant, workspace.company, permissions, workspace.request]);
  const navigate = value => {window.location.hash = `/${value}`;};
  const allowed = value => canOpenOperationsRoute(workspace.context, value);
  let content = null;
  if (!workspace.signedIn) content = <section className="ecommerce-welcome"><p className="eyebrow">E-COMMERCE</p><h1>Controla tus pedidos y operaciones.</h1><p>Gestiona tu tienda, catálogo y entregas desde un solo lugar.</p><button disabled={workspace.authenticating} onClick={workspace.startLogin}>{workspace.authenticating ? 'Iniciando sesión…' : 'Iniciar sesión'}</button></section>;
  else if (workspace.loading) content = <p role="status">Preparando tu espacio de trabajo…</p>;
  else if (!workspace.tenant) content = <div className="notice">Selecciona un espacio para continuar.</div>;
  else if (!workspace.company) content = <div className="notice">Selecciona una empresa para consultar sus operaciones.</div>;
  else if (!enabled) content = <div className="notice error">E-commerce no está habilitado para este espacio.</div>;
  else if (route === 'summary' && allowed('summary')) content = <EcommerceSummary context={workspace.context} runtime={runtime} navigate={navigate}/>;
  else if (route === 'orders' && allowed('orders')) content = <Orders key={path} runtime={runtime}/>;
  else if (route === 'payments' && allowed('payments')) content = <PaymentConfiguration key={path} runtime={runtime}/>;
  else if (route === 'preparation' && allowed('preparation')) content = <Preparation key={path} runtime={runtime}/>;
  else if (route === 'routes' && allowed('routes')) content = <Routes key={path} runtime={runtime}/>;
  else if (route === 'drivers' && allowed('drivers')) content = <Drivers key={path} runtime={runtime}/>;
  else if (route === 'nodes' && allowed('nodes')) content = <Nodes key={path} runtime={runtime}/>;
  else if (route === 'products' && allowed('products')) content = <Products key={path} runtime={runtime}/>;
  else if (route === 'categories' && allowed('categories')) content = <Categories key={path} runtime={runtime}/>;
  else if (route === 'attributes' && allowed('attributes')) content = <Attributes key={path} runtime={runtime}/>;
  else if (route === 'brands' && allowed('brands')) content = <Brands key={path} runtime={runtime}/>;
  else if (route === 'suppliers' && allowed('suppliers')) content = <Suppliers key={path} runtime={runtime}/>;
  else if (route === 'inventory' && allowed('inventory')) content = <Inventory key={path} runtime={runtime}/>;
  else content = <div className="notice error">No tienes permiso para consultar esta capacidad.</div>;
  return <FinanceAssistantProvider applicationName="E-commerce" contextLabel={routeLabels[route]} contextKey={[workspace.signedIn,workspace.tenant,workspace.company].join(':')}><div className="integrated-app ecommerce-app"><a className="skip-link" href="#content">Saltar al contenido</a>
    <header className="integrated-header"><button ref={menuTrigger} type="button" className="menu-toggle secondary" aria-controls="ecommerce-navigation" aria-label="Abrir menú" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button><a className="brand" href="#/summary">Uonify Commerce<span>Entorno de desarrollo</span></a>
      <div className="context-controls"><CommerceHeaderMenus workspace={workspace}/><FinanceAssistantToggle/><ModuleLauncher currentApp="ecommerce"/>{!workspace.signedIn && <button className="secondary" disabled={workspace.authenticating} onClick={workspace.startLogin}>{workspace.authenticating ? 'Redirigiendo…' : 'Acceder'}</button>}</div>
    </header><div className="integrated-layout"><div className="finance-service-rail"><RelatedServicesRail currentApp="ecommerce" services={['uonify','finance','ecommerce','inventory','agents']}/></div><aside id="ecommerce-navigation" aria-label="Navegacion de Ecommerce" className={`integrated-nav ${menu ? 'is-open' : ''}`}><OperationsNavigation context={workspace.context} route={route} navigate={navigate}/></aside>{menu&&<button type="button" className="finance-nav-scrim" aria-label="Cerrar menu de Ecommerce" onClick={()=>{setMenu(false);menuTrigger.current?.focus();}}/>}<main id="content" className="integrated-content" tabIndex={-1}><p className="environment">Uonify Commerce · Entorno de desarrollo</p>{workspace.error && <div className="notice error" role="alert">{workspace.error}</div>}{content}</main><FinanceAssistantPanel/></div>
  </div></FinanceAssistantProvider>;
}
