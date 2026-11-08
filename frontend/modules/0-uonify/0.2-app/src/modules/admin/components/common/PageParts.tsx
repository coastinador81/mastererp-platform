import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ApiError, errorMessage } from '@/shared/api/client';
import { Alert, Badge, Button, Empty, Spinner, type IconName } from '@/shared/ui';
import type { StatusLabel } from '../../model/labels';

/** Cabecera de una sección del panel: h1, una línea de contexto y acciones. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="adm-page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="adm-page-actions">{actions}</div> : null}
    </header>
  );
}

/** Carga, error con «Reintentar» o vacío de una consulta. */
export function QueryState({
  isPending,
  error,
  onRetry,
  empty,
  emptyTitle,
  emptyDescription,
  emptyIcon = 'search',
  loadingLabel = 'Cargando…',
  children,
}: {
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: IconName;
  loadingLabel?: string;
  children?: ReactNode;
}) {
  if (isPending) {
    return (
      <div className="adm-state">
        <Spinner label={loadingLabel} />
      </div>
    );
  }
  if (error) {
    // Las secciones aún no construidas responden 404 (ruta sin montar) o 401 (sin
    // capacidad todavía): se muestra «en construcción», sin inventar datos ni alarmar.
    // Un 401 de sesión caducada lo gestiona useSessionExpiry (vuelve al acceso); aquí
    // la sesión sigue válida. Cuando el backend construya la sección, esto desaparece.
    if (error instanceof ApiError && (error.status === 404 || error.status === 401)) {
      return (
        <Alert tone="info" role="status" title="Sección en construcción">
          <p className="adm-alert-text">Esta parte del panel aún no está disponible; estará lista en una próxima entrega.</p>
        </Alert>
      );
    }
    return (
      <Alert tone="red" role="alert" title="No se ha podido cargar">
        <p className="adm-alert-text">{errorMessage(error)}</p>
        {onRetry ? (
          <Button size="sm" icon="refresh-cw" onClick={onRetry}>
            Reintentar
          </Button>
        ) : null}
      </Alert>
    );
  }
  if (empty) return <Empty icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}

export function StatusBadge({ status, className }: { status: StatusLabel; className?: string }) {
  return (
    <Badge tone={status.tone} className={className}>
      {status.label}
    </Badge>
  );
}

/** Contenedor de tabla: el desplazamiento horizontal queda dentro, nunca en la página. */
export function TableWrap({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('adm-table-wrap', className)} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** Cifra del cuadro: etiqueta, valor y variación opcional frente al periodo anterior. */
export function StatTile({ label, value, delta, hint }: { label: string; value: string; delta?: string | null; hint?: string }) {
  const down = delta?.startsWith('−');
  return (
    <div className="adm-stat">
      <span className="adm-stat-label">{label}</span>
      <strong className="adm-stat-value">{value}</strong>
      {delta ? (
        <span className={clsx('adm-stat-delta', down ? 'is-down' : 'is-up')}>
          {delta} <span className="pim-sr-only">frente al periodo anterior</span>
          <span aria-hidden="true"> vs. anterior</span>
        </span>
      ) : null}
      {hint ? <span className="adm-stat-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Barra de nivel (gasto frente al tope, cuentas por plan). El relleno lleva el estado
 * y la pista es un tono claro del mismo color.
 */
export function Meter({ value, max, tone = 'blue', label }: { value: number; max: number; tone?: 'blue' | 'amber' | 'red'; label: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 1;
  return (
    <div
      className={clsx('adm-meter', `is-${tone}`)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
    >
      <span style={{ width: `${Math.round(ratio * 1000) / 10}%` }} />
    </div>
  );
}
