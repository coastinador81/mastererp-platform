import { useId } from 'react';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { primaryOwner } from '../model/validation';
import { useAuditStore } from '../hooks/useAuditStore';
import { useUrlAudit } from '../hooks/useUrlAudit';
import { AuditProgress } from './AuditProgress';

/**
 * «Análisis Web Inteligente» (URLAnalyzer, E04-E09): URL en mono, «Auditar Producto» al
 * lado (sólido solo mientras ninguna otra vista tiene la tarea abierta), formatos como
 * ayuda, progreso de la auditoría y error del análisis.
 */
export function UrlAnalyzer() {
  const { audit, patch } = useAuditStore();
  const { isAuditing, progress, handleAudit } = useUrlAudit();
  const titleId = useId();
  const inputId = useId();
  const disabled = isAuditing || !audit.auditUrl || !audit.auditUrl.trim();
  const variant = primaryOwner(audit) === 'audit' ? 'pim-btn-primary' : 'pim-btn-outline';

  return (
    <section className="pim-section is-divided pim-auditoria-url" aria-labelledby={titleId}>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={titleId}>
          <Icon name="link" size={16} />
          <span>Análisis Web Inteligente</span>
        </h3>
      </div>
      <div className="pim-field">
        <label className="pim-label" htmlFor={inputId}>URL del Producto</label>
        <div className="pim-auditoria-url-row">
          <input
            id={inputId}
            className="pim-input pim-mono"
            type="text"
            data-focus="audit-url"
            value={audit.auditUrl || ''}
            placeholder="https://ejemplo.com/producto"
            disabled={audit.isScrapingActive}
            autoComplete="off"
            spellCheck={false}
            onChange={event => patch({ auditUrl: event.target.value })}
          />
          <button
            type="button"
            className={clsx('pim-btn', variant, 'pim-auditoria-audit-btn')}
            data-focus="audit-btn"
            disabled={disabled}
            onClick={() => void handleAudit()}
          >
            {isAuditing ? <Icon name="refresh-cw" size={16} className="pim-spin" /> : <Icon name="scan" size={16} />}
            {isAuditing ? 'Auditando...' : 'Auditar Producto'}
          </button>
        </div>
        <p className="pim-hint pim-auditoria-formats">
          <strong>Formatos soportados:</strong> URL genérica o completa • <strong>Amazon:</strong> Link o ASIN (<code className="pim-mono">B08X...</code>) • <strong>EAN:</strong> Código de barras (búsqueda en Google Shopping)
        </p>
      </div>
      {isAuditing ? <AuditProgress label="Progreso de auditoría" value={progress} ai /> : null}
      {audit.scrapingError ? (
        <div className="pim-alert pim-alert-red pim-auditoria-error" role="alert">
          <Icon name="x-circle" size={16} />
          <span>{audit.scrapingError}</span>
        </div>
      ) : null}
    </section>
  );
}
