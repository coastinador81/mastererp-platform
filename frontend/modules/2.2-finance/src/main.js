import {mountWorkspace} from '../../../app-shell/src/Shell.jsx';
import './finance.css';
import './uonify-theme.css';
const query=new URLSearchParams(window.location.search);
const devPreview=import.meta.env.DEV||import.meta.env.MODE==='dev';
const designEntry=window.location.pathname==='/'&&!window.location.hash&&!query.has('id')&&!query.has('accion')&&(query.get('demo')==='compras'||['resumen-compras','sugerencias-compras'].includes(query.get('vista'))||(!query.has('vista')&&query.get('datos')!=='reales'));
const demoRequested=devPreview&&designEntry;
if(query.get('datos')!=='reales'&&(import.meta.env.DEV||demoRequested)&&['resumen-compras','solicitudes-compra','sugerencias-compras','ordenes-compra'].includes(query.get('vista')||(demoRequested?'resumen-compras':''))&&!query.has('id')&&!query.has('accion')){
 import('./local/PurchasesPreview.jsx').then(({mountPurchasesPreview})=>mountPurchasesPreview(document.getElementById('root')));
}else{
 mountWorkspace(document.getElementById('root'),{independent:true});
}
