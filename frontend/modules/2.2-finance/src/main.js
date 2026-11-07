import {mountWorkspace} from '../../../app-shell/src/Shell.jsx';
import './finance.css';
const query=new URLSearchParams(window.location.search);
if(import.meta.env.DEV&&['resumen-compras','solicitudes-compra','sugerencias-compras','ordenes-compra'].includes(query.get('vista'))&&!query.has('id')&&!query.has('accion')){
 import('./local/PurchasesPreview.jsx').then(({mountPurchasesPreview})=>mountPurchasesPreview(document.getElementById('root')));
}else{
 mountWorkspace(document.getElementById('root'),{independent:true});
}
