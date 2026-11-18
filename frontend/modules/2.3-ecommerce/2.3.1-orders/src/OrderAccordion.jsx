import React from 'react';

export default function OrderAccordion({title,description,actions,children,className=''}) {
  return <details className={`od-card od-accordion ${className}`.trim()}>
    <summary>
      <span><strong>{title}</strong>{description?<small>{description}</small>:null}</span>
      <span className="od-accordion-controls">{actions}<i aria-hidden="true">⌄</i></span>
    </summary>
    <div className="od-accordion-content">{children}</div>
  </details>;
}
