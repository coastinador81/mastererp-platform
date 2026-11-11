import React from 'react';
const entries=[
  ['my-route','Mi ruta','transport.deliveries.execute'],
  ['drivers','Repartidores','transport.drivers.read'],
  ['routes','Rutas','operations.routes.read'],
];
export default function TransportNavigation({permissions,route,navigate}){
 return <nav className="finance-navigation" aria-label="Navegación de Repartidores"><p className="finance-nav-heading">TRANSPORTE</p><ul>{entries.filter(([, ,permission])=>permissions.includes(permission)).map(([id,label])=><li key={id}><button type="button" className={route===id?'active':''} onClick={()=>navigate(id)}>{label}</button></li>)}</ul></nav>;
}
