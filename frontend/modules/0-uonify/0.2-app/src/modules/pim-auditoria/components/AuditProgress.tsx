import { Progress } from '@/shared/ui';

export interface AuditProgressProps {
  label: string;
  /** 0-100. */
  value: number;
  /** Barra de lo que hace la IA (azul → aqua). */
  ai?: boolean;
}

/** Fila «texto · %» con su barra (progreso de auditoría y de documentos). */
export function AuditProgress({ label, value, ai = false }: AuditProgressProps) {
  return (
    <div className="pim-auditoria-progress">
      <div className="pim-auditoria-progress-row">
        <span>{label}</span>
        <span className="pim-auditoria-progress-value">{Math.round(value)}%</span>
      </div>
      <Progress value={value} label={label} ai={ai} className="pim-auditoria-bar" />
    </div>
  );
}
