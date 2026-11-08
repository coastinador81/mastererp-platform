import { useId, type ReactNode } from 'react';
import clsx from 'clsx';
import { errorMessage } from '@/shared/api/client';
import { Alert, Icon, LinkButton, Spinner, type IconName } from '@/shared/ui';

/** Piezas comunes de las secciones de Configuración (tarjetas, filas y estados de carga). */

export interface SettingsCardProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  /** Acciones a la derecha del título. */
  actions?: ReactNode;
  /** Insignia junto al título (estado). */
  badge?: ReactNode;
  tone?: 'default' | 'danger';
  className?: string;
  children?: ReactNode;
}

export function SettingsCard({ title, description, icon, actions, badge, tone = 'default', className, children }: SettingsCardProps) {
  const titleId = useId();
  return (
    <section className={clsx('uset-card', tone === 'danger' && 'is-danger', className)} aria-labelledby={titleId}>
      <div className="uset-card-head">
        <div className="uset-card-heading">
          <h3 className="uset-card-title" id={titleId}>
            {icon ? <Icon name={icon} size={16} /> : null}
            <span>{title}</span>
            {badge}
          </h3>
          {description ? <p className="uset-card-sub">{description}</p> : null}
        </div>
        {actions ? <div className="uset-card-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Fila de ajuste: icono, título, descripción y acciones a la derecha (debajo en móvil). */
export function SettingRow({ title, description, icon, badge, actions, className, children }: SettingRowProps) {
  return (
    <div className={clsx('uset-row', className)}>
      {icon ? <span className="uset-row-icon" aria-hidden="true"><Icon name={icon} size={16} /></span> : null}
      <div className="uset-row-main">
        <p className="uset-row-title">
          <span>{title}</span>
          {badge}
        </p>
        {description ? <div className="uset-row-sub">{description}</div> : null}
        {children}
      </div>
      {actions ? <div className="uset-row-actions">{actions}</div> : null}
    </div>
  );
}

/** Cargando una sección (anunciado a lectores de pantalla). */
export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="uset-loading">
      <Spinner label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

/** Error al cargar, con reintento. */
export function LoadError({ error, onRetry, title = 'No se ha podido cargar' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Alert tone="red" role="alert" title={title}>
      <span>{errorMessage(error, 'Revisa tu conexión e inténtalo de nuevo.')} </span>
      {onRetry ? <LinkButton onClick={onRetry}>Reintentar</LinkButton> : null}
    </Alert>
  );
}

/** Avatar redondo con foto o iniciales. */
export function Avatar({ src, name, size = 40, className }: { src?: string | null; name: string; size?: number; className?: string }) {
  const letters = name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'U';
  return (
    <span className={clsx('uset-avatar', className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : letters}
    </span>
  );
}
