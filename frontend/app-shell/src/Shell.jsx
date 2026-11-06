import React, {useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {config,WorkspaceProvider,useWorkspace} from './session.jsx';
import Finance from '../../modules/2.2-finance/src/Finance.jsx';
import FinanceNavigation from '../../modules/2.2-finance/src/FinanceNavigation.jsx';
import Conversation from '../../modules/0-uonify/components/Conversation.jsx';
import Products from '../../modules/2.1-catalog/2.1.1-products/src/Products.jsx';
import Categories from '../../modules/2.1-catalog/2.1.2-categories/src/Categories.jsx';
import Attributes from '../../modules/2.1-catalog/2.1.3-attributes/src/Attributes.jsx';
import Brands from '../../modules/2.1-catalog/2.1.4-brands/src/Brands.jsx';
import Suppliers from '../../modules/2.1-catalog/2.1.5-suppliers/src/Suppliers.jsx';
import Inventory from '../../modules/2.1-catalog/2.1.6-inventory/src/Inventory.jsx';
import Orders from '../../modules/2.3-operations/2.3.1-orders/src/Orders.jsx';
import Preparation from '../../modules/2.3-operations/2.3.2-preparation/src/Preparation.jsx';
import Routes from '../../modules/2.3-operations/2.3.3-routes/src/Routes.jsx';
import Nodes from '../../modules/2.3-operations/2.3.4-nodes/src/Nodes.jsx';
import Drivers from '../../modules/2.10-transport/2.10.1-drivers/src/Drivers.jsx';
import Ecommerce from '../../modules/2.4-digital-sales/2.4.2-ecommerce/src/Ecommerce.jsx';
import './shell.css';
import {workspacePath,financeUrl} from './financeRoutes.mjs';
function Shell({independent=false}) {
  const w=useWorkspace(),[path,setPath]=useState(()=>workspacePath(window.location,independent)),[menu,setMenu]=useState(false);
  useEffect(()=>{const change=()=>{const route=workspacePath(window.location,independent);if(independent&&window.location.pathname!=='/auth/callback'&&window.location.hash){const url=financeUrl(route);if(url)window.history.replaceState(null,'',url);}setPath(route);setMenu(false);};window.addEventListener('hashchange',change);window.addEventListener('popstate',change);return()=>{window.removeEventListener('hashchange',change);window.removeEventListener('popstate',change);};},[independent]);
  const navigate=route=>{const url=independent?financeUrl(route):null;if(url){window.history.pushState(null,'',url);setPath(route);setMenu(false);}else if(window.location.hash!=='#'+route)window.location.hash=route;};
  const finance=w.context?.modules.includes('erp.finance')&&w.context?.permissions.some(p=>['administration.parties.read','administration.purchases.read'].includes(p));
  const products=w.context?.modules.includes('erp.catalog')&&w.context?.permissions.includes('catalog.products.read');
  const categories=w.context?.modules.includes('erp.catalog')&&w.context?.permissions.includes('catalog.categories.read');
  const inventory=w.context?.modules.includes('erp.catalog')&&w.context?.permissions.includes('catalog.inventory.read');
  const attributes=w.context?.permissions.includes('catalog.attributes.read'),brands=w.context?.permissions.includes('catalog.brands.read'),suppliers=w.context?.permissions.includes('catalog.suppliers.read');
  const orders=w.context?.modules.includes('erp.operations')&&w.context?.permissions.includes('operations.orders.read');
  const nodes=w.context?.modules.includes('erp.operations')&&w.context?.permissions.includes('operations.nodes.read');
  const preparation=w.context?.permissions.includes('operations.preparation.read');
  const routes=w.context?.permissions.includes('operations.routes.read');
  const drivers=w.context?.permissions.includes('transport.drivers.read');
  const ecommerce=w.context?.permissions.includes('digital_sales.ecommerce.read');
  const financeRoute=path.startsWith('/modulos/finanzas');
  const productsRoute=path==='/modulos/catalogo/productos';
  const categoriesRoute=path==='/modulos/catalogo/categorias';
  const inventoryRoute=path==='/modulos/catalogo/inventario';
  const attributesRoute=path==='/modulos/catalogo/atributos',brandsRoute=path==='/modulos/catalogo/marcas',suppliersRoute=path==='/modulos/catalogo/proveedores';
  const ordersRoute=path==='/modulos/operaciones/pedidos';
  const nodesRoute=path==='/modulos/operaciones/nodos';
  const preparationRoute=path==='/modulos/operaciones/preparacion',routesRoute=path==='/modulos/operaciones/rutas',driversRoute=path==='/modulos/transporte/repartidores';
  const ecommerceRoute=path==='/modulos/ventas-digitales/tiendas';
  const productsRuntime=useMemo(()=>({api:config.adminApiUrl,tenant:w.tenant,permissions:w.context?.permissions||[],request:w.request}),[w.tenant,w.context,w.request]);
  const categoriesRuntime=useMemo(()=>({api:config.adminApiUrl,tenant:w.tenant,permissions:w.context?.permissions||[],request:w.request}),[w.tenant,w.context,w.request]);
  const operationalRuntime=useMemo(()=>({api:config.adminApiUrl,tenant:w.tenant,company:w.company,permissions:w.context?.permissions||[],request:w.request}),[w.tenant,w.company,w.context,w.request]);
  const ordersRuntime=useMemo(()=>({api:config.adminApiUrl,tenant:w.tenant,company:w.company,permissions:w.context?.permissions||[],request:w.request}),[w.tenant,w.company,w.context,w.request]);
  return <div className="integrated-app"><a className="skip-link" href="#workspace-content" onClick={e=>{e.preventDefault();document.getElementById('workspace-content')?.focus();}}>Saltar al contenido</a>
    <header className="integrated-header"><button className="menu-toggle secondary" aria-label="Abrir menú" aria-expanded={menu} onClick={()=>setMenu(!menu)}>☰</button><a className="brand" href={independent?'/':'#/'}>{independent?'Finanzas':'Uonify'}<span>MasterERP · Desarrollo</span></a>
      <div className="context-controls"><button className="secondary" disabled={w.authenticating} onClick={w.signedIn?w.signOut:w.startLogin}>{w.signedIn?'Salir':w.authenticating?'Redirigiendo…':'Acceder'}</button></div>
    </header>
    <div className="integrated-layout"><aside className={'integrated-nav '+(menu?'is-open':'')} aria-label="Navegación principal">{independent?<FinanceNavigation allowed={Boolean(finance)} path={path} navigate={navigate}/>:<><p className="nav-caption">ESPACIO DE TRABAJO</p><a href="#/" aria-current={path==='/'?'page':undefined}>Inicio</a><a href="#/chat" aria-current={path==='/chat'?'page':undefined}>Chat operativo</a>
      <p className="nav-caption">MÓDULOS HABILITADOS</p>{finance&&<><a href="#/modulos/finanzas" aria-current={financeRoute?'page':undefined}>Finanzas</a><span className="nav-section">Administración</span><a className="subnav" href="#/modulos/finanzas/administracion/clientes">Clientes</a><a className="subnav" href="#/modulos/finanzas/administracion/proveedores">Proveedores</a></>}
      {(products||categories||attributes||brands||suppliers||inventory)&&<><span className="nav-section">Catálogo</span>{products&&<a className="subnav" href="#/modulos/catalogo/productos" aria-current={productsRoute?'page':undefined}>Productos</a>}{categories&&<a className="subnav" href="#/modulos/catalogo/categorias" aria-current={categoriesRoute?'page':undefined}>Categorías</a>}{attributes&&<a className="subnav" href="#/modulos/catalogo/atributos" aria-current={attributesRoute?'page':undefined}>Atributos</a>}{brands&&<a className="subnav" href="#/modulos/catalogo/marcas" aria-current={brandsRoute?'page':undefined}>Marcas</a>}{suppliers&&<a className="subnav" href="#/modulos/catalogo/proveedores" aria-current={suppliersRoute?'page':undefined}>Proveedores</a>}{inventory&&<a className="subnav" href="#/modulos/catalogo/inventario" aria-current={inventoryRoute?'page':undefined}>Inventario</a>}</>}
      {(orders||preparation||routes||nodes)&&<><span className="nav-section">Operaciones</span>{orders&&<a className="subnav" href="#/modulos/operaciones/pedidos" aria-current={ordersRoute?'page':undefined}>Pedidos</a>}{preparation&&<a className="subnav" href="#/modulos/operaciones/preparacion" aria-current={preparationRoute?'page':undefined}>Preparación</a>}{routes&&<a className="subnav" href="#/modulos/operaciones/rutas" aria-current={routesRoute?'page':undefined}>Rutas</a>}{nodes&&<a className="subnav" href="#/modulos/operaciones/nodos" aria-current={nodesRoute?'page':undefined}>Nodos</a>}</>}
      {drivers&&<><span className="nav-section">Transporte</span><a className="subnav" href="#/modulos/transporte/repartidores" aria-current={driversRoute?'page':undefined}>Repartidores</a></>}
      {ecommerce&&<><span className="nav-section">Ventas digitales</span><a className="subnav" href="#/modulos/ventas-digitales/tiendas" aria-current={ecommerceRoute?'page':undefined}>Tiendas</a></>}
      {!finance&&!products&&!categories&&!orders&&<p className="nav-empty">{w.signedIn?'No hay módulos autorizados disponibles.':'Accede para consultar tus módulos.'}</p>}</>}{!independent&&<div className="nav-footer">Identidad compartida<br/>Permisos verificados por MasterERP</div>}</aside>
      <main id="workspace-content" className="integrated-content" tabIndex={-1}>
        {independent&&<p className="notice">Finanzas · Entorno de desarrollo · Administración</p>}
        {w.error&&<div className="notice error" role="alert">{w.error} {w.signedIn&&<button className="secondary" onClick={()=>w.refresh()}>Revalidar acceso</button>}</div>}
        {!independent&&path==='/chat'?<Conversation/>:
         independent&&!w.signedIn?<section><h1>{path.includes('/proveedores')?'Proveedores':'Administración'}</h1><p>Inicia sesión para consultar y administrar los proveedores de tu empresa.</p></section>:
         !w.signedIn?<section className="hero"><p className="eyebrow">UN ESPACIO, TUS OPERACIONES</p><h1>Tu trabajo,<br/><em>conectado.</em></h1><p>{independent?'Accede para trabajar con Administración y selecciona tu empresa.':'Accede a tu espacio para abrir los módulos de tu empresa o trabajar con el chat.'}</p><button onClick={w.startLogin}>Acceder a mi espacio</button><p className="muted">Cognito autentica. MasterERP valida cada operación.</p></section>:
         w.loading?<p role="status">Validando espacio y permisos…</p>:
         !w.tenant?<div className="notice" role="status">{w.spaces.length?'Selecciona un espacio para continuar.':'Todavía no tienes un espacio asignado.'}</div>:
         !w.context?<div className="notice">El contexto autorizado no está disponible.</div>:
         (financeRoute||independent)?<Finance workspace={w} path={path} navigate={navigate}/>:
         productsRoute&&products?<Products runtime={productsRuntime}/>:
         categoriesRoute&&categories?<Categories runtime={categoriesRuntime}/>:
         attributesRoute&&attributes?<Attributes runtime={categoriesRuntime}/>:
         brandsRoute&&brands?<Brands runtime={categoriesRuntime}/>:
         suppliersRoute&&suppliers?<Suppliers runtime={categoriesRuntime}/>:
         inventoryRoute&&inventory?<Inventory runtime={operationalRuntime}/>:
         ordersRoute&&orders?<Orders runtime={ordersRuntime}/>:
         preparationRoute&&preparation?<Preparation runtime={operationalRuntime}/>:
         routesRoute&&routes?<Routes runtime={operationalRuntime}/>:
         nodesRoute&&nodes?<Nodes runtime={operationalRuntime}/>:
         driversRoute&&drivers?<Drivers runtime={operationalRuntime}/>:
         ecommerceRoute&&ecommerce?<Ecommerce runtime={operationalRuntime}/>:
         path!=='/'?<section><h1>Página no disponible</h1><a href="#/">Volver al inicio</a></section>:
         <section><p className="eyebrow">TU ESPACIO DE TRABAJO</p><h1>Todo empieza aquí.</h1><p>Abre un módulo desde el menú. También puedes visitar el chat, sin que sea obligatorio conversar.</p><div className="cards">{finance&&<a className="panel module-card" href="#/modulos/finanzas"><span>FINANZAS</span><h2>Finanzas</h2><p>Administración, Clientes y Proveedores.</p><strong>Abrir módulo →</strong></a>}{products&&<a className="panel module-card" href="#/modulos/catalogo/productos"><span>CATÁLOGO</span><h2>Productos</h2><p>Ficha maestra comercial compartida por todos los canales.</p><strong>Abrir módulo →</strong></a>}{categories&&<a className="panel module-card" href="#/modulos/catalogo/categorias"><span>CATÁLOGO</span><h2>Categorías</h2><p>Clasificación canónica compartida por todos los canales.</p><strong>Abrir módulo →</strong></a>}{orders&&<a className="panel module-card" href="#/modulos/operaciones/pedidos"><span>OPERACIONES</span><h2>Pedidos</h2><p>Ciclo operativo manual sobre el pedido canónico.</p><strong>Abrir módulo →</strong></a>}<a className="panel module-card" href="#/chat"><span>UONIFY</span><h2>Chat operativo</h2><p>Espacio conversacional. Asistente aún sin conectar.</p></a></div>{!finance&&!products&&!categories&&!orders&&<p className="notice">No hay módulos funcionales autorizados para este espacio.</p>}</section>}
      </main></div></div>;
}
export function mountWorkspace(element,options={}) {if(options.independent&&window.location.pathname==='/'&&window.location.hash){const url=financeUrl(workspacePath(window.location,true));if(url)window.history.replaceState(null,'',url);}createRoot(element).render(<WorkspaceProvider><Shell {...options}/></WorkspaceProvider>);}
