import type { DataExport } from './types';

/** Palabra que hay que escribir para confirmar la eliminación de la cuenta. */
export const DELETE_CONFIRM_WORD = 'ELIMINAR';
/** Días para arrepentirse antes del borrado definitivo. */
export const DELETION_GRACE_DAYS = 30;

export function deletionConfirmed(value: string): boolean {
  return value.trim().toUpperCase() === DELETE_CONFIRM_WORD;
}

/** Lo que pasa al eliminar la cuenta (se enseña antes de confirmar). */
export const DELETION_CONSEQUENCES: readonly string[] = [
  `Tienes ${DELETION_GRACE_DAYS} días para cancelar la eliminación desde esta misma pantalla. Pasado ese plazo, el borrado es definitivo.`,
  'Al terminar el plazo se cierran todas las sesiones y las personas de tu equipo pierden el acceso.',
  'Se desconectan ChatGPT y Amazon. Los datos obtenidos de Amazon se borran en un plazo de 30 días.',
  'Se borran tus productos, imágenes, vídeos, modelos 3D, hilos y ajustes.',
  'Se cancela la renovación de tu plan. Si estás dentro de los 14 días de desistimiento, pide antes la devolución en Plan y facturación.',
  'Conservamos las facturas durante el plazo que exige la ley.',
];

/** La exportación más reciente que siga en curso o lista para descargar. */
export function latestExport(exports: readonly DataExport[]): DataExport | null {
  const active = exports.filter(item => item.status !== 'expired');
  return active.sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))[0] ?? null;
}

/** Nombre del archivo descargado: «uonify-mis-datos-2026-09-27.json». */
export function exportFileName(date = new Date()): string {
  return `uonify-mis-datos-${date.toISOString().slice(0, 10)}.json`;
}
