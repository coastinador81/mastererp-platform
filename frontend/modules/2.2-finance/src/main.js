import {mountWorkspace} from '../../../app-shell/src/Shell.jsx';
import './finance.css';
const query=new URLSearchParams(window.location.search);
const demoRequested=import.meta.env.MODE==='dev'&&query.get('demo')==='compras';
if((import.meta.env.DEV||demoRequested)&&['resumen-compras','solicitudes-compra','sugerencias-compras','ordenes-compra'].includes(query.get('vista')||(demoRequested?'resumen-compras':''))&&!query.has('id')&&!query.has('accion')){
 import('./local/PurchasesPreview.jsx').then(({mountPurchasesPreview})=>mountPurchasesPreview(document.getElementById('root')));
}else{
 mountWorkspace(document.getElementById('root'),{independent:true});
}
