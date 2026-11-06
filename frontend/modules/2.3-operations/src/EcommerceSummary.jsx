import React from 'react';
import {canOpenOperationsRoute} from './access.mjs';

const cards=[
  ['orders','Pedidos','Consulta y gestiona el ciclo operativo de cada pedido.'],
  ['preparation','Preparación','Organiza los productos antes de su entrega.'],
  ['routes','Rutas','Consulta la planificación de entregas.'],
  ['nodes','Nodos','Administra las capacidades de cada ubicación.'],
  ['products','Productos','Gestiona la ficha comercial del catálogo.'],
  ['inventory','Inventario','Consulta existencias disponibles por nodo.'],
];

export default function EcommerceSummary({context,navigate}){
  const visible=cards.filter(([route])=>canOpenOperationsRoute(context,route));
  return <section><p className="eyebrow">Módulo habilitado</p><h1>Resumen de Pedidos</h1><p>Administración de E-commerce, operaciones y catálogo de tu empresa.</p><div className="cards">{visible.map(([route,title,description])=><a key={route} className="panel module-card" href={`#/${route}`} onClick={event=>{event.preventDefault();navigate(route);}}><h3>{title}</h3><p>{description}</p><strong>Abrir →</strong></a>)}</div>{!visible.length&&<p className="notice">No tienes capacidades de E-commerce autorizadas.</p>}</section>;
}
