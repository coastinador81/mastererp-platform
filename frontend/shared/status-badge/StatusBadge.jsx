import React from 'react';
import {statusTone} from './statusTone.mjs';
import './status-badge.css';

export default function StatusBadge({status, tone, children}){
  return <span className={`status-badge status-badge-${tone||statusTone(status)}`}><span className="status-badge-dot" aria-hidden="true"/>{children}</span>;
}
