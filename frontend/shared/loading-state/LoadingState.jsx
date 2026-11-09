import React from 'react';
import './loading-state.css';

export default function LoadingState({label='Cargando…'}){
  return <div className="loading-state" role="status" aria-live="polite"><span className="loading-state-spinner" aria-hidden="true"/><span>{label}</span></div>;
}
