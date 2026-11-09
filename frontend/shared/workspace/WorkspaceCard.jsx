import React from 'react';
import FinanceIcon from '../../modules/2.2-finance/src/FinanceIcon.jsx';
import './workspace-card.css';

export default function WorkspaceCard({application, options, value, onChange, icon='order'}){
  const selected=options.find(option=>option.value===value)||options[0];
  return <section className="workspace-card" aria-label="Selector de espacio de trabajo"><span className="workspace-card-caption">ESPACIO DE TRABAJO</span><div className="workspace-card-body"><span className="workspace-card-icon"><FinanceIcon name={selected?.icon||icon}/></span><label className="workspace-card-copy"><strong>{application}</strong><span className="sr-only">Pantalla activa</span><select value={value} onChange={event=>onChange(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div></section>;
}
