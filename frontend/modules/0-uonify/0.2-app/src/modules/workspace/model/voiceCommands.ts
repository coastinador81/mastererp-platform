export interface VoiceInput { text: string; hold: boolean; action: 'wait' | 'send' | 'stop' }
/** Solo el «listo» final cierra una instrucción larga; un «producto listo» no la ejecuta. */
export function voiceInput(transcript: string, buffer: string, holding: boolean): VoiceInput {
  const clean = transcript.trim();
  if (/^(?:uony[, ]*)?(?:para|detente|deja de escuchar)[.!]?$/i.test(clean)) return { text: buffer, hold: false, action: 'stop' };
  const asksHold = /(?:espera(?: a que diga)?|hasta que diga|cuando (?:te )?diga)\s+[«“"']?listo[»”"']?|no he terminado/i;
  const hold = holding || asksHold.test(clean);
  const content = clean.replace(asksHold, '').replace(/^[, .]+/, '').trim();
  const done = holding && /(?:^|[,.;]\s*|\s+)listo[.!]?$/i.test(content);
  const text = [buffer, done ? content.replace(/(?:^|\s+)listo[.!]?$/i, '').replace(/[,.;]\s*$/, '') : content].filter(Boolean).join(' ').trim();
  return { text, hold: hold && !done, action: done ? (text ? 'send' : 'wait') : hold ? 'wait' : 'send' };
}
