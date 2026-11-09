import React from 'react';
import FinanceIcon from '../../modules/2.2-finance/src/FinanceIcon.jsx';
import './workspace-card.css';

export default function WorkspaceCard({application,section,icon='summary'}){
  return <section className="workspace-card" aria-label={`Espacio de trabajo: ${application}, ${section}`}><span className="workspace-card-caption">ESPACIO DE TRABAJO</span><div className="workspace-card-body"><span className="workspace-card-icon"><FinanceIcon name={icon}/></span><span className="workspace-card-copy"><strong>{application}</strong><small>{section}</small></span></div></section>;
}
