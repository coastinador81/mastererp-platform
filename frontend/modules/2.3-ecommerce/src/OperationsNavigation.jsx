import React from 'react';
import {canOpenOperationsRoute} from './access.mjs';
import FinanceIcon from '../../2.2-finance/src/FinanceIcon.jsx';
import WorkspaceCard from '../../../shared/workspace/WorkspaceCard.jsx';

const operations = [
  ['summary', 'Resumen', 'summary'], ['orders', 'Pedidos', 'order'],
  ['preparation', 'Preparación', 'document'], ['routes', 'Rutas', 'route'],
  ['nodes', 'Nodos', 'location'], ['payments', 'Métodos de pago', 'invoice'],
];
const catalog = [
  ['products', 'Productos', 'package'], ['categories', 'Categorías', 'order'],
  ['attributes', 'Atributos', 'quote'], ['brands', 'Marcas', 'quote'],
  ['suppliers', 'Proveedores', 'supplier'],
];
export default function OperationsNavigation({context, route, navigate}) {
  const operationLinks = operations.filter(([value]) => canOpenOperationsRoute(context, value));
  const catalogLinks = catalog.filter(([value]) => canOpenOperationsRoute(context, value));
  const active = catalog.some(([value]) => value === route) ? 'catalog' : 'operations';
  const options = [
    ...(operationLinks.length ? [{value: 'operations', label: 'Operaciones', icon: 'route'}] : []),
    ...(catalogLinks.length ? [{value: 'catalog', label: 'Catálogo', icon: 'package'}] : []),
  ];
  const links = active === 'catalog' ? catalogLinks : operationLinks;
  return <nav className="finance-navigation" aria-label="Espacios de Ecommerce">
    {options.length > 0 && <WorkspaceCard application="E-commerce" showSelectedIcon value={active} options={options} onChange={value => navigate((value === 'catalog' ? catalogLinks : operationLinks)[0][0])}/>}
    <p className="nav-caption">{active === 'catalog' ? 'CATÁLOGO' : 'OPERACIONES'}</p>
    {links.map(([value, label, icon]) => <a key={value} href={`#/${value}`} title={label} aria-current={route === value ? 'page' : undefined}><FinanceIcon name={icon}/><span className="finance-nav-label">{label}</span></a>)}
  </nav>;
}
