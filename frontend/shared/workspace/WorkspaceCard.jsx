import React from 'react';
import FinanceIcon from '../../modules/2.2-finance/src/FinanceIcon.jsx';
import './workspace-card.css';

export default function WorkspaceCard({application, options, value, onChange, showSelectedIcon = false}){
  const selected=options.find(option=>option.value===value)||options[0];
  return <section className="workspace-card" aria-label="Espacio de trabajo"><span className="workspace-card-caption">ESPACIO DE TRABAJO</span><details className="workspace-card-menu"><summary className="workspace-card-body"><span className="workspace-card-icon"><FinanceIcon name={showSelectedIcon ? selected?.icon : 'plus'}/></span><span className="workspace-card-copy"><strong>{application}</strong><small>{selected?.label}</small></span><span className="workspace-card-chevron">⌄</span></summary><div className="workspace-card-options">{options.map(option=><button key={option.value} className={option.value===value?'active':''} onClick={event=>{event.currentTarget.closest('details').removeAttribute('open');onChange(option.value);}}><FinanceIcon name={option.icon}/><span>{option.label}</span></button>)}</div></details></section>;
}
