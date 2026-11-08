import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/shared/ui';
import type { AuditResult } from '../model/types';
import { display } from '../model/translations';
import { auditErrorMessage, auditProduct } from '../api/auditApi';
import { runScrape } from '../api/auditJobs';
import { useAuditStore } from './useAuditStore';
import { useAuditFocus } from './useAuditFocus';

/** Progreso simulado de la auditoría (el del original): +10 % cada 500 ms hasta 90 %. */
export const AUDIT_PROGRESS_STEP = 10;
export const AUDIT_PROGRESS_TICK_MS = 500;
export const AUDIT_PROGRESS_CAP = 90;
/** La barra vuelve a 0 un segundo después de terminar. */
export const AUDIT_PROGRESS_RESET_MS = 1000;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Atributos de Amazon del resultado (A04: vacío si no llegan). */
function attributesOf(result: AuditResult | null): Record<string, unknown> {
  if (!result || !isObject(result.ai_audit)) return {};
  return isObject(result.ai_audit.amazon_attributes) ? result.ai_audit.amazon_attributes : {};
}

/**
 * URLAnalyzer.handleAudit: lanza a la vez el análisis (paso «1. Analiza») y la
 * auditoría, con su progreso. El estado local (auditando, %) se pierde al cambiar de
 * pestaña, como en el original; el resultado se guarda en el producto aunque se cambie.
 */
export function useUrlAudit() {
  const { scope, read, patch, productId } = useAuditStore();
  const requestFocus = useAuditFocus();
  const [isAuditing, setIsAuditing] = useState(false);
  const [progress, setProgress] = useState(0);
  const timers = useRef<{ interval?: ReturnType<typeof setInterval>; reset?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    const current = timers.current;
    return () => {
      clearInterval(current.interval);
      clearTimeout(current.reset);
    };
  }, []);

  // handleAuditComplete de AuditoriaIATab (sin el TypeError de A04).
  const onAuditComplete = useCallback((result: AuditResult | null) => {
    patch({ auditResult: result, amazonAttributes: attributesOf(result) });
  }, [patch]);

  const handleAudit = useCallback(async () => {
    const auditUrl = read().auditUrl;
    if (!auditUrl || !auditUrl.trim()) return;
    onAuditComplete(null);
    void runScrape(scope, productId);
    clearTimeout(timers.current.reset);
    setIsAuditing(true);
    setProgress(0);
    let interval: ReturnType<typeof setInterval> | undefined;
    try {
      interval = setInterval(() => setProgress(value => Math.min(value + AUDIT_PROGRESS_STEP, AUDIT_PROGRESS_CAP)), AUDIT_PROGRESS_TICK_MS);
      timers.current.interval = interval;
      const result = await auditProduct(auditUrl);
      clearInterval(interval);
      setProgress(100);
      toast.success(`✅ Auditoría completada: ${display(result.detected_category ?? '')}`);
      onAuditComplete(result);
    } catch (error) {
      toast.error(`❌ Error en auditoría: ${auditErrorMessage(error)}`);
    } finally {
      clearInterval(interval); // MF2: sin intervalos acumulados tras un error
      setIsAuditing(false);
      requestFocus('audit-btn', { onlyIfLost: true });
      timers.current.reset = setTimeout(() => setProgress(0), AUDIT_PROGRESS_RESET_MS);
    }
  }, [read, onAuditComplete, scope, productId, requestFocus]);

  return { isAuditing, progress, handleAudit };
}
