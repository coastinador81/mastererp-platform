/** Describe la petición en curso sin anunciar resultados que todavía no existen. */
export function pendingLabel(text: string, step?: string): string {
  const value = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/vista previa|revisar.*version|como.*quedar/.test(value)) return 'Preparando la vista previa…';
  if (/^(conecta|conectar|autorizar|autorizo|continuar con)\b/.test(value)) return 'Preparando la conexión…';
  if (/^(aprobado|apruebo|publica|subelo)/.test(value) && step) return 'Revisando tu aprobación…';
  if (/^(cambia|cambiar|modifica|actualiza|mejora)/.test(value)) return 'Revisando los cambios…';
  if (step === 'folder') return 'Localizando los archivos…';
  if (step === 'files' && /^(si|vale|adelante|prepara|continua)/.test(value)) return 'Preparando tu ficha…';
  if (/amazon|subir.*producto|publicar.*producto/.test(value)) return 'Preparando los siguientes pasos…';
  return 'Revisando tu petición…';
}
