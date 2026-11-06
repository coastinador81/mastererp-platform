import React from 'react';
import {routePermissions} from './access.mjs';
import FinanceIcon from '../../2.2-finance/src/FinanceIcon.jsx';
import {ChevronDownIcon} from '../../0-uonify/components/ShellIcons.tsx';

const operations = [
  ['orders', 'Pedidos', 'order'],
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
  ['inventory', 'Inventario', 'invoice'],
];

export default function OperationsNavigation({permissions, route, navigate}) {
  const visible = links => links.filter(([value]) => value==='summary'||permissions.includes(routePermissions[value]));
  const operationLinks=visible(operations),catalogLinks=visible(catalog);
  const items = links => links.map(([value, label, icon]) => <li key={value}><a href={`#/${value}`} className="subnav" aria-current={route === value ? 'page' : undefined} onClick={event => {event.preventDefault(); navigate(value);}}><FinanceIcon name={icon}/><span>{label}</span></a></li>);
  return <nav className="finance-navigation" aria-label="Operaciones">
    <p className="nav-caption">E-COMMERCE</p>
    <a href="#/summary" aria-current={route==='summary'?'page':undefined} onClick={event=>{event.preventDefault();navigate('summary');}}><FinanceIcon name="summary"/><span>Resumen de Pedidos</span></a>
    <details className="administration-nav" open><summary className="administration-nav-title"><ChevronDownIcon className="finance-disclosure-icon"/>Gestión de e-Commerce</summary><div className="administration-nav-children"><ul>{items(operationLinks)}<li><span className="finance-nav-pending"><FinanceIcon name="invoice"/><span>Facturas</span><small>Pendiente</small></span></li></ul></div></details>
    <details className="administration-nav" open><summary className="administration-nav-title"><ChevronDownIcon className="finance-disclosure-icon"/>Gestión de Catálogo</summary><div className="administration-nav-children"><ul>{items(catalogLinks)}</ul></div></details>
  </nav>;
}
