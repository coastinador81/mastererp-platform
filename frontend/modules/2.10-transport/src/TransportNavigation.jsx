import React from 'react';
import FinanceIcon from '../../2.2-finance/src/FinanceIcon.jsx';
import WorkspaceCard from '../../../shared/workspace/WorkspaceCard.jsx';
const entries=[
  ['my-route','Mi ruta','route','transport.deliveries.execute'],
  ['drivers','Repartidores','supplier','transport.drivers.read'],
  ['routes','Rutas','route','operations.routes.read'],
];
export default function TransportNavigation({permissions,route,navigate}){
 const links=entries.filter(([, , ,permission])=>permissions.includes(permission));
 return <nav className="finance-navigation" aria-label="Espacios de Repartidores">
  <WorkspaceCard application="Repartidores" showSelectedIcon value="transport" options={[{value:'transport',label:'Transporte',icon:'route'}]} onChange={()=>{}}/>
  <p className="nav-caption">TRANSPORTE</p>
  {links.map(([id,label,icon])=><a key={id} href={`#/${id}`} title={label} aria-current={route===id?'page':undefined}><FinanceIcon name={icon}/><span className="finance-nav-label">{label}</span></a>)}
 </nav>;
}
