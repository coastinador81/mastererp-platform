import React from 'react';
import {routePermissions} from './access.mjs';
import FinanceIcon from '../../2.2-finance/src/FinanceIcon.jsx';
import {ChevronDownIcon} from '../../0-uonify/components/ShellIcons.tsx';
import WorkspaceCard from '../../../shared/workspace/WorkspaceCard.jsx';

const operations = [
  ['orders', 'Pedidos', 'order'],
  ['payments', 'Métodos de pago', 'invoice'],
  ['preparation', 'Preparación', 'document'],
  ['routes', 'Rutas', 'sales'],
  ['nodes', 'Nodos', 'supplier'],
];
const catalog = [
  ['products', 'Productos', 'document'],
  ['categories', 'Categorías', 'order'],
  ['attributes', 'Atributos', 'quote'],
  ['brands', 'Marcas', 'sales'],
  ['suppliers', 'Proveedores', 'supplier'],
];

export default function OperationsNavigation({permissions, route, navigate}) {
  const visible = links => links.filter(([value]) => value==='summary'||permissions.includes(routePermissions[value]));
  const operationLinks=visible(operations),catalogLinks=visible(catalog);
  const items = links => links.map(([value, label, icon]) => <li key={value}><a href={`#/${value}`} className="subnav" title={label} aria-current={route === value ? 'page' : undefined} onClick={event => {if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault(); navigate(value);}}><FinanceIcon name={icon}/><span className="finance-nav-label">{label}</span></a></li>);
  return <nav className="finance-navigation" aria-label="Operaciones">
    <WorkspaceCard application="E-commerce" value={catalog.some(([value])=>value===route)?'catalog':'operations'} onChange={value=>navigate(value==='catalog'?(catalogLinks[0]?.[0]||'products'):'summary')} options={[{value:'operations',label:'Operaciones',icon:'route'},...(catalogLinks.length?[{value:'catalog',label:'Catálogo',icon:'order'}]:[])]}/>
    <p className="nav-caption">E-COMMERCE</p>
    <a href="#/summary" title="Resumen de Pedidos" aria-current={route==='summary'?'page':undefined} onClick={event=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate('summary');}}><FinanceIcon name="summary"/><span className="finance-nav-label">Resumen de Pedidos</span></a>
    <details className="administration-nav" open><summary className="administration-nav-title" title="Operaciones"><FinanceIcon name="sales"/><span className="finance-nav-label">Operaciones</span><ChevronDownIcon className="finance-disclosure-icon"/></summary><div className="administration-nav-children"><ul>{items(operationLinks)}<li><span className="finance-nav-pending"><FinanceIcon name="invoice"/><span>Facturas</span><small>Pendiente</small></span></li></ul></div></details>
    <details className="administration-nav" open><summary className="administration-nav-title" title="Catálogo"><FinanceIcon name="order"/><span className="finance-nav-label">Catálogo</span><ChevronDownIcon className="finance-disclosure-icon"/></summary><div className="administration-nav-children"><ul>{items(catalogLinks)}</ul></div></details>
  </nav>;
}
