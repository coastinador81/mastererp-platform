import type { ComponentProps, ElementType, ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';

/**
 * Estructura de una pestaña (prototipo: .pim-head, .pim-section, .pim-section-head,
 * .pim-toolbar y .pim-divider). Secciones planas separadas por espacio y una
 * línea fina, no cajas de colores anidadas.
 */

export interface HeadProps extends Omit<ComponentProps<'header'>, 'title'> {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  /** Acciones a la derecha del título (.pim-head-row). */
  actions?: ReactNode;
  /** Nivel del título (h2 por defecto). */
  as?: ElementType;
}

/** Cabecera de una pestaña: título + una línea de contexto. */
export function Head({ title, subtitle, icon, actions, as: Title = 'h2', className, children, ...rest }: HeadProps) {
  const heading = (
    <Title className="pim-head-title">
      {icon ? <Icon name={icon} size={18} /> : null}
      {title}
    </Title>
  );
  return (
    <header className={clsx('pim-head', className)} {...rest}>
      {actions ? <div className="pim-head-row">{heading}{actions}</div> : heading}
      {subtitle ? <p className="pim-head-sub">{subtitle}</p> : null}
      {children}
    </header>
  );
}

export interface SectionProps extends ComponentProps<'section'> {
  /** Línea superior aunque no siga a otra sección (.is-divided). */
  divided?: boolean;
  as?: ElementType;
}

export function Section({ divided = false, as: Tag = 'section', className, ...rest }: SectionProps) {
  return <Tag className={clsx('pim-section', divided && 'is-divided', className)} {...rest} />;
}

export interface SectionHeadProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  /** Nivel del título (h3 por defecto). */
  as?: ElementType;
  titleId?: string;
}

/** Título de sección a la izquierda y acciones a la derecha. */
export function SectionHead({ title, subtitle, icon, actions, as: Title = 'h3', titleId, className, ...rest }: SectionHeadProps) {
  return (
    <div className={clsx('pim-section-head', className)} {...rest}>
      <div>
        <Title className="pim-section-title" id={titleId}>
          {icon ? <Icon name={icon} size={16} /> : null}
          {title}
        </Title>
        {subtitle ? <p className="pim-section-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="pim-section-actions">{actions}</div> : null}
    </div>
  );
}

/** Fila de acciones de icono (botones fantasma de 32 px con tooltip). */
export function Toolbar({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={clsx('pim-toolbar', className)} {...rest} />;
}

/** Separador fino (.pim-divider). */
export function Divider({ className, ...rest }: ComponentProps<'hr'>) {
  return <hr className={clsx('pim-divider', className)} {...rest} />;
}
