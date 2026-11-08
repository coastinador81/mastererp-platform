import type { SVGProps } from 'react';
import clsx from 'clsx';
import { iconHeight, iconViewBox, iconMarkup, iconWidth, type IconName } from './registry';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'dangerouslySetInnerHTML' | 'children'> {
  name: IconName;
  /** Lado en píxeles (16 por defecto; la marca de Uony usa un mínimo óptico de 28). */
  size?: number;
  /** Nombre accesible. Sin él, el icono es decorativo (aria-hidden). */
  label?: string;
}

/** Icono lucide de trazo con la clase «pim-icon» del prototipo (o la marca rellena de Uony). */
export function Icon({ name, size = 16, label, className, ...rest }: IconProps) {
  return (
    <svg
      className={clsx('pim-icon', name === 'uony' && 'pim-icon-uony', className)}
      width={iconWidth(name, size)}
      height={iconHeight(name, size)}
      viewBox={iconViewBox(name, size)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
      // El interior sale del registro (marcado propio, nunca de datos de usuario).
      dangerouslySetInnerHTML={{ __html: iconMarkup(name, size) }}
    />
  );
}
