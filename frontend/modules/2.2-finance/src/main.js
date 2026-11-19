import {mountWorkspace} from '../../../app-shell/src/Shell.jsx';
import '../../../shared/ui/admin-application.css';
import './uonify-theme.css';
import '../../../shared/ui/application-header.css';
import {initializeApplicationTheme} from '../../../shared/ui/application-theme.mjs';
import '../../../shared/ui/application-theme.css';
initializeApplicationTheme();
const query=new URLSearchParams(window.location.search);
const devPreview=import.meta.env.DEV||import.meta.env.MODE==='dev';
const demoRequested=devPreview&&query.get('demo')==='compras'&&window.location.pathname==='/'&&!window.location.hash&&!query.has('id')&&!query.has('accion');
if(query.get('datos')!=='reales'&&(import.meta.env.DEV||demoRequested)&&['resumen-compras','solicitudes-compra','sugerencias-compras'].includes(query.get('vista')||(demoRequested?'resumen-compras':''))&&!query.has('id')&&!query.has('accion')){
 import('./local/PurchasesPreview.jsx').then(({mountPurchasesPreview})=>mountPurchasesPreview(document.getElementById('root')));
}else{
 mountWorkspace(document.getElementById('root'),{independent:true});
}
