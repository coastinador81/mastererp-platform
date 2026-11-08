import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import RelatedServicesRail from '../../../../shared/module-launcher/RelatedServicesRail.jsx';
import {FinanceAssistantProvider,FinanceAssistantToggle,FinanceAssistantPanel} from '../FinanceAssistant.jsx';
import FinanceNavigation from '../FinanceNavigation.jsx';
import ModuleLauncher from '../ModuleLauncher.jsx';
import UonifyChatLink from '../UonifyChatLink.jsx';
import PurchasesSummary from '../../2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/PurchasesSummary.jsx';
import '../../../../app-shell/src/shell.css';
import './purchasesPreview.css';
import PurchasesListPreview from './PurchasesListPreview.jsx';
import PurchaseSuggestionsPreview from './PurchaseSuggestionsPreview.jsx';
import {totalOf} from './suggestionReview.mjs';

const previewNodes=[{id:'preview-node-a',name:'Nodo de ejemplo A'},{id:'preview-node-b',name:'Nodo de ejemplo B'},{id:'preview-node-c',name:'Nodo de ejemplo C'}];

function PurchasesPreview(){
 const [menu,setMenu]=useState(false);
 const [approvedPurchases,setApprovedPurchases]=useState([]);
 const [nodeReviews,setNodeReviews]=useState({});
 const [nodeNotes,setNodeNotes]=useState({});
 const [reviewDrafts,setReviewDrafts]=useState({});
 const reviewByNode=suggestion=>setNodeReviews(old=>old[suggestion.id]?old:{...old,[suggestion.id]:{at:new Date().toISOString(),note:nodeNotes[suggestion.id]||'',proposal:{quantity:suggestion.quantity,price:suggestion.price,supplier:suggestion.supplier},original:{...suggestion.original}}});
 const approveSuggestion=suggestion=>{if(!nodeReviews[suggestion.id])return;const reference='DEMO-COM-IA-'+suggestion.id;const row={reference,date:'2026-11-08',node:suggestion.node,supplier:suggestion.supplier,concept:suggestion.product,currency:'VES',total:totalOf(suggestion),status:'Borrador',source:'DEMO-SUG-'+suggestion.id,suggestion,originalProposal:nodeReviews[suggestion.id].original,nodeProposal:nodeReviews[suggestion.id].proposal,priority:Boolean(suggestion.priority),purchasingObservation:suggestion.purchasingNote||'',nodeReviewedAt:nodeReviews[suggestion.id].at,nodeObservation:nodeReviews[suggestion.id].note,approvedAt:new Date().toISOString()};setApprovedPurchases(old=>old.some(item=>item.reference===reference)?old:[...old,row]);window.history.pushState({},'','/?demo=compras&vista=solicitudes-compra&compra_demo='+reference);setView('solicitudes-compra');setMenu(false);};
 const readView=()=>new URLSearchParams(window.location.search).get('vista')||'resumen-compras';
 const [view,setView]=useState(readView);
 useEffect(()=>{const back=()=>{setView(readView());setMenu(false);};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 const navigate=path=>{const next=path.split('/').at(-1);if(!['resumen-compras','solicitudes-compra','sugerencias-compras','ordenes-compra'].includes(next)){window.location.assign('/?vista='+encodeURIComponent(next));return;}window.history.pushState({},'', '/?demo=compras&vista='+next);setView(next);setMenu(false);};
 return <FinanceAssistantProvider path={view}><div className="integrated-app purchases-local-preview"><a className="skip-link" href="#purchase-preview-content">Saltar al contenido</a>
  <header className="integrated-header"><button type="button" className="menu-toggle secondary" aria-label="Abrir menú" aria-expanded={menu} onClick={()=>setMenu(!menu)}>☰</button><a className="brand" href="/?demo=compras&vista=resumen-compras">Finanzas<span>MasterERP · Desarrollo</span></a><div className="context-controls"><FinanceAssistantToggle/><UonifyChatLink/><ModuleLauncher currentApp="finance"/><span className="purchases-local-badge">DEMO · Sin datos reales</span></div></header>
  <div className="integrated-layout"><div className="finance-service-rail"><RelatedServicesRail currentApp="finance" services={['uonify','finance','ecommerce','inventory','agents']}/></div><aside className={'integrated-nav '+(menu?'is-open':'')} aria-label="Navegación principal"><FinanceNavigation onClose={()=>setMenu(false)} previewOnly allowed={false} path={'/modulos/finanzas/administracion/'+view} navigate={navigate}/></aside>{menu&&<button type="button" className="finance-nav-scrim" aria-label="Cerrar menu de Finanzas" onClick={()=>setMenu(false)}/>}<main id="purchase-preview-content" className="integrated-content" tabIndex={-1}>{view==='sugerencias-compras'?<PurchaseSuggestionsPreview reviewDrafts={reviewDrafts} onDraftChange={(key,value)=>setReviewDrafts(old=>({...old,[key]:value}))} nodeNotes={nodeNotes} onNoteChange={(id,note)=>setNodeNotes(old=>({...old,[id]:note}))} nodeReviews={nodeReviews} onNodeReview={reviewByNode} nodes={previewNodes} approvedPurchases={approvedPurchases} onApprove={approveSuggestion}/>:['solicitudes-compra','ordenes-compra'].includes(view)?<PurchasesListPreview key={view} approvedPurchases={approvedPurchases} nodes={previewNodes} kind={view==='ordenes-compra'?'orders':'purchases'}/>:<PurchasesSummary nodes={previewNodes}/>}</main><FinanceAssistantPanel/></div>
 </div></FinanceAssistantProvider>;
}
export function mountPurchasesPreview(element){createRoot(element).render(<PurchasesPreview/>);}
