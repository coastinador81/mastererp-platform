import React,{useEffect,useRef,useState} from 'react';
import ModuleLauncher from '../../../shared/module-launcher/ModuleLauncher.jsx';
import RelatedServicesRail from '../../../shared/module-launcher/RelatedServicesRail.jsx';
import UonifyChatLink from '../../2.2-finance/src/UonifyChatLink.jsx';
import FinanceIcon from '../../2.2-finance/src/FinanceIcon.jsx';

const groups=[
 {name:'Existencias',icon:'inventory',items:[['existencias','Por producto'],['existencias-sucursal','Por sucursal']]},
 {name:'Movimientos',icon:'movements',items:[['entradas','Entradas'],['salidas','Salidas'],['transferencias','Transferencias']]},
 {name:'Recepciones',icon:'receipt',items:[['recepciones-pendientes','Pendientes'],['recepciones-recibidas','Recibidas']]},
 {name:'Conteos y ajustes',icon:'count',items:[['conteos','Conteos físicos'],['ajustes','Ajustes']]},
];
const pages={
 resumen:{title:'Resumen',description:'Una visión de las existencias y la actividad de tu inventario.'},
 existencias:{title:'Existencias por producto',description:'Consulta stock físico, reservado y disponible.',columns:['Código','Producto','Unidad','Stock físico','Reservado','Disponible']},
 'existencias-sucursal':{title:'Existencias por sucursal',description:'La consulta por sucursal estará disponible al activar Nodos en Ecommerce.',nodes:true},
 entradas:{title:'Entradas',description:'Consulta los ingresos de productos y sus documentos de origen.',columns:['Referencia','Fecha','Producto','Cantidad','Origen','Estado']},
 salidas:{title:'Salidas',description:'Consulta las salidas de productos y su documento de origen.',columns:['Referencia','Fecha','Producto','Cantidad','Destino','Estado']},
 transferencias:{title:'Transferencias',description:'Las transferencias entre sucursales requieren la capacidad Nodos.',nodes:true},
 'recepciones-pendientes':{title:'Recepciones pendientes',description:'Recibe los productos de las órdenes de compra autorizadas.',columns:['Orden de compra','Proveedor','Entrega prevista','Líneas pendientes','Estado']},
 'recepciones-recibidas':{title:'Recepciones recibidas',description:'Consulta las recepciones y sus documentos de origen.',columns:['Recepción','Fecha','Orden de compra','Proveedor','Estado']},
 conteos:{title:'Conteos físicos',description:'Compara las existencias registradas con las cantidades contadas.',columns:['Referencia','Fecha','Alcance','Responsable','Estado']},
 ajustes:{title:'Ajustes',description:'Consulta diferencias de inventario con su motivo y trazabilidad.',columns:['Referencia','Fecha','Producto','Diferencia','Motivo','Estado']},
 configuracion:{title:'Configuración',description:'Parámetros y capacidades del inventario.'},
};
function Icon({name}){
 const paths={inventory:<><path d="M3 21V8l9-5 9 5v13M7 21V11h10v10M3 21h18m-11-6h4"/></>,movements:<><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"/></>,receipt:<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3"/></>,count:<><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9V3Zm0 10 2 2 4-4"/></>,settings:<><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.5 5.5 7 7m10 10 1.5 1.5m0-13L17 7M7 17l-1.5 1.5"/></>};
 return <svg className="inventory-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.inventory}</svg>;
}
export default function InventoryApp(){
 const readView=()=>new URLSearchParams(window.location.search).get('vista')||'resumen';
 const [view,setView]=useState(readView),[menu,setMenu]=useState(false);
 const content=useRef(null),menuButton=useRef(null),page=pages[view];
 useEffect(()=>{const escape=e=>{if(menu&&e.key==='Escape'){setMenu(false);menuButton.current?.focus();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[menu]);
 useEffect(()=>{const back=()=>{setView(readView());setMenu(false);};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 useEffect(()=>{document.title=(page?.title||'Página no disponible')+' · Inventario — MasterERP DEV';},[view]);
 const navigate=(event,next)=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();window.history.pushState({},'','/?vista='+next);setView(next);setMenu(false);content.current?.focus();};
 const link=(key,label)=> <a key={key} href={'/?vista='+key} aria-current={view===key?'page':undefined} onClick={event=>navigate(event,key)}>{label}</a>;
 return <div className="inventory-app"><a className="inventory-skip" href="#inventory-content">Saltar al contenido</a>
  <header className="inventory-header"><button ref={menuButton} className="inventory-menu-toggle" type="button" aria-label={menu?'Cerrar menú':'Abrir menú'} aria-expanded={menu} aria-controls="inventory-navigation" onClick={()=>setMenu(!menu)}>☰</button><a className="inventory-brand" href="/" onClick={event=>navigate(event,'resumen')}>Inventario<span>MasterERP · {import.meta.env.VITE_ENVIRONMENT_LABEL||'Desarrollo'}</span></a><div className="inventory-tools"><UonifyChatLink/><ModuleLauncher currentApp="inventory"/><span className="inventory-badge">Base visual</span></div></header>
  {menu&&<button className="inventory-overlay" aria-label="Cerrar menú de navegación" onClick={()=>setMenu(false)}/>}
  <div className="inventory-layout"><div className="inventory-service-rail"><RelatedServicesRail currentApp="inventory"/></div><aside id="inventory-navigation" className={'inventory-sidebar '+(menu?'is-open':'')}><nav aria-label="Inventario"><p className="inventory-caption">INVENTARIO</p><div className="inventory-nav-summary"><FinanceIcon name="summary"/>{link('resumen','Resumen')}</div>{groups.map(group=><details key={group.name} open><summary><Icon name={group.icon}/>{group.name}<span aria-hidden="true">⌄</span></summary><div className="inventory-nav-items">{group.items.map(([key,label])=>link(key,label))}</div></details>)}<div className="inventory-nav-summary"><Icon name="settings"/>{link('configuracion','Configuración')}</div></nav></aside>
   <main id="inventory-content" ref={content} tabIndex={-1} className="inventory-content"><p className="inventory-breadcrumb">Inventario / {page?.title||'No disponible'}</p><div className="inventory-heading"><div><h1>{page?.title||'Página no disponible'}</h1><p>{page?.description||'Esta dirección no corresponde a una pantalla de Inventario.'}</p></div><span className="inventory-badge">Desarrollo</span></div>
    {!page?<section className="inventory-panel"><p>Vuelve al Resumen para continuar.</p>{link('resumen','Ir a Resumen')}</section>:view==='resumen'?<>
     <div className="inventory-metrics">{['Productos con existencias','Stock disponible','Faltantes por revisar','Movimientos recientes'].map(label=><section className="inventory-panel" key={label}><Icon name="inventory"/><h2>{label}</h2><p className="inventory-metric-value">—</p><small>Sin conexión de datos</small></section>)}</div>
     <div className="inventory-overview-grid"><section className="inventory-panel"><h2>Existencias</h2><p>El stock físico, reservado y disponible aparecerá aquí al integrar los servicios autorizados.</p>{link('existencias','Consultar existencias →')}</section><section className="inventory-panel"><h2>Actividad reciente</h2><p>No hay movimientos conectados en esta base visual.</p>{link('entradas','Consultar movimientos →')}</section></div>
    </>:view==='configuracion'?<section className="inventory-panel"><h2>Operación por sucursal</h2><dl><dt>Modo inicial</dt><dd>Una sucursal predeterminada, sin selector de nodos.</dd><dt>Multinodo</dt><dd>Disponible cuando se active Nodos en Ecommerce y se valide el acceso a sus sucursales.</dd><dt>Productos</dt><dd>Se reutilizará el maestro de Catálogo, sin duplicarlo.</dd></dl><p>Esta pantalla no activa capacidades ni cambia configuración real.</p></section>:page.nodes?<section className="inventory-panel inventory-empty"><Icon name="inventory"/><h2>Requiere Nodos</h2><p>Al activar esta capacidad en Ecommerce, Inventario podrá operar por sucursal según los permisos del usuario.</p><p>No se muestran sucursales ficticias ni un selector sin datos autorizados.</p></section>:<section className="inventory-panel"><div className="inventory-table-scroll"><table><caption className="inventory-sr-only">{page.title}</caption><thead><tr>{page.columns.map(column=><th scope="col" key={column}>{column}</th>)}</tr></thead><tbody><tr><td colSpan={page.columns.length}><div className="inventory-empty"><Icon name="inventory"/><h2>Sin datos conectados</h2><p>Esta es la base visual de {page.title.toLowerCase()}. La consulta y las operaciones se integrarán posteriormente.</p></div></td></tr></tbody></table></div></section>}
    <p className="inventory-footnote">Base visual DEV · Sin datos reales ni operaciones de inventario. La autenticación, los permisos y la activación de Nodos se integrarán con los servicios existentes.</p>
   </main>
  </div>
 </div>;
}
