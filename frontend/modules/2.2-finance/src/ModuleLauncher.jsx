import React,{useEffect,useId,useRef,useState} from 'react';
import './moduleLauncher.css';

const modules=[
 {name:'Plataforma base',color:'slate',icon:'platform',routes:[]},
 {name:'Inventario',code:'erp.catalog',color:'teal',icon:'inventory',routes:[['catalog.inventory.read','catalogo/inventario']]},
 {name:'Operaciones',code:'erp.operations',color:'orange',icon:'operations',routes:[['operations.orders.read','operaciones/pedidos'],['operations.preparation.read','operaciones/preparacion'],['operations.routes.read','operaciones/rutas'],['operations.nodes.read','operaciones/nodos']]},
 {name:'Ecommerce',code:'digital_sales.ecommerce',color:'violet',icon:'sales',routes:[['digital_sales.ecommerce.read','ventas-digitales/tiendas']]},
 {name:'Servicios',color:'teal',icon:'services',routes:[]},
 {name:'Centro de Agentes',code:'agent_center',color:'violet',icon:'agents',routes:[]},
 {name:'Recursos humanos',color:'rose',icon:'people',routes:[]},
 {name:'Productividad',color:'indigo',icon:'productivity',routes:[]},
 {name:'Punto de venta',color:'orange',icon:'pos',routes:[]},
 {name:'Transporte',code:'erp.transport',color:'rose',icon:'transport',routes:[['transport.drivers.read','transporte/repartidores']]},
 {name:'Seguridad',color:'slate',icon:'security',routes:[]},
];
const paths={
 uonify:<><path d="M5 5v8a7 7 0 0 0 14 0V5M9 5v8a3 3 0 0 0 6 0V5"/><path d="m18 3 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/></>,
 finance:<><path d="M4 20h16M6 16v-4m6 4V8m6 8V4"/><path d="m5 8 6-5 4 2 4-3"/></>,
 inventory:<><path d="M3 21V9l9-6 9 6v12M7 21V11h10v10M3 21h18M7 15h10m-10 3h10"/><path d="M10 11v10m4-10v10"/></>,
 operations:<><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M9 5V3h6v2M8 10h1m3 0h4m-8 5h1m3 0h4"/></>,
 sales:<><path d="M3 4h2l2 12h12l2-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
 transport:<><path d="M3 5h11v12H3V5Zm11 5h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
 platform:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
 services:<><path d="m14 5 5 5M9 10l-6 6a3 3 0 0 0 5 5l6-6M14 3a6 6 0 0 0-6 8l5 5a6 6 0 0 0 8-6l-4 3-4-4 3-4-2-2Z"/></>,
 agents:<><rect x="4" y="7" width="16" height="14" rx="4"/><path d="M12 7V3M2 12v5m20-5v5M9 16h6"/><circle cx="9" cy="12" r=".5"/><circle cx="15" cy="12" r=".5"/></>,
 people:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/></>,
 productivity:<><rect x="4" y="4" width="16" height="17" rx="3"/><path d="M8 3v3m8-3v3M4 10h16m-12 5 3 3 5-5"/></>,
 pos:<><rect x="3" y="3" width="18" height="12" rx="2"/><path d="M9 15v5m6-5v5M6 21h12M7 7h5m-5 4h9"/></>,
 security:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
};
function ModuleIcon({name}){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;}

export default function ModuleLauncher({context,signedIn}){
 const [open,setOpen]=useState(false),root=useRef(null),trigger=useRef(null),id=useId();
 const preview=import.meta.env.DEV||import.meta.env.MODE==='dev';
 const visible=modules.flatMap(module=>{
  const route=module.routes.find(([permission])=>context?.permissions?.includes(permission));
  if(context?.modules?.includes(module.code)&&route)return [{...module,href:'https://app-dev.uonify.com/#/modulos/'+route[1]}];
  return preview?[module]:[];
 });
 useEffect(()=>{
  if(!open)return;
  const outside=event=>{if(!root.current?.contains(event.target))setOpen(false);};
  const keyboard=event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',keyboard);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',keyboard);};
 },[open]);
 useEffect(()=>{setOpen(false);},[context,signedIn]);
 return <div className="finance-launcher" ref={root}>
  <button ref={trigger} type="button" className="secondary finance-launcher-trigger" aria-label="Abrir módulos" title="Módulos de MasterERP" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}>
   <svg viewBox="0 0 24 24" aria-hidden="true">{[5,12,19].flatMap(y=>[5,12,19].map(x=><circle key={x+'-'+y} cx={x} cy={y} r="1.6"/>))}</svg>
  </button>
  {open&&<section id={id} className="finance-launcher-panel" aria-label="Módulos de MasterERP">
   <div className="finance-launcher-heading"><div><strong>Tu espacio de trabajo</strong><p>MasterERP + Uonify</p></div><button type="button" className="secondary finance-launcher-close" aria-label="Cerrar módulos" onClick={()=>{setOpen(false);trigger.current?.focus();}}>×</button></div>
   <div className="finance-launcher-grid">
    <div className="finance-launcher-tile is-current" aria-current="true"><span className="finance-module-icon blue"><ModuleIcon name="finance"/></span><span>Finanzas</span><small>Estás aquí</small></div>
    {visible.map(module=>{
     const content=<><span className={'finance-module-icon '+module.color}><ModuleIcon name={module.icon}/></span><span>{module.name}</span>{!module.href&&<small>{module.routes.length?'Vista previa':'Pendiente'}</small>}</>;
     return module.href?<a className="finance-launcher-tile" href={module.href} key={module.name}>{content}</a>:<div className="finance-launcher-tile is-preview" aria-disabled="true" key={module.name}>{content}</div>;
    })}
   </div>
   <p className="finance-launcher-note">{preview?'Vista de diseño DEV · Todos los módulos. Los accesos requieren habilitación y permisos.':!signedIn?'Accede para ver los módulos disponibles para tu usuario.':!context?'Los módulos aparecerán al validar tu espacio.':'Solo aparecen módulos habilitados con acceso autorizado.'}</p>
  </section>}
 </div>;
}
