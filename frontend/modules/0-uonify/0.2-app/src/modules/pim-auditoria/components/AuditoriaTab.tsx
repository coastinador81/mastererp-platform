import { useEffect, useRef } from 'react';
import '../styles/index.css';
import { showIntro } from '../model/validation';
import { isScrapingInFlight } from '../api/auditJobs';
import { useAuditStore } from '../hooks/useAuditStore';
import { AuditFocusContext, useFocusManager } from '../hooks/useAuditFocus';
import { AuditHeader } from './AuditHeader';
import { AuditIntro } from './AuditIntro';
import { UrlAnalyzer } from './UrlAnalyzer';
import { AmazonAttributes } from './AmazonAttributes';
import { CategorySuggestion } from './CategorySuggestion';
import { CategorySelector } from './CategorySelector';
import { SchemaComparison } from './SchemaComparison';

/**
 * Pestaña «Auditoría IA» (prototipo: pim/auditoria.js). Anatomía: intro (pim-head) →
 * instrucciones (solo en vacío, como el original) → secciones planas (URL, resultado
 * de la IA, categoría, esquema).
 */
export function AuditoriaTab() {
  const { audit, scope, patch } = useAuditStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const requestFocus = useFocusManager(rootRef);

  // Un análisis que no sigue en marcha (p. ej. tras recargar) no deja la URL bloqueada.
  useEffect(() => {
    if (audit.isScrapingActive && !isScrapingInFlight(scope)) patch({ isScrapingActive: false });
    // Solo al montar, como el original.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuditFocusContext.Provider value={requestFocus}>
      <div className="pim-auditoria" ref={rootRef}>
        <AuditHeader />
        {showIntro(audit) ? <AuditIntro /> : null}
        <UrlAnalyzer />
        {audit.auditResult ? <AmazonAttributes /> : null}
        {audit.suggestedCategory && audit.isCategoryConfirmed === null ? <CategorySuggestion /> : null}
        {audit.isCategoryConfirmed === false ? <CategorySelector /> : null}
        {audit.showSchemaComparison && audit.uonifySchema ? <SchemaComparison /> : null}
      </div>
    </AuditFocusContext.Provider>
  );
}
