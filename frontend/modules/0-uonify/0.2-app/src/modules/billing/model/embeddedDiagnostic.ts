function field(value: unknown, name: string): unknown {
  try { return value && typeof value === 'object' ? Reflect.get(value, name) : undefined; }
  catch { return undefined; }
}

/** El SDK puede rechazar con un objeto recibido de otro contexto, no solo Error. */
export function stripeErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, 8192);
  for (const value of [error, field(error, 'error'), field(error, 'cause')]) {
    const message = field(value, 'message');
    if (typeof message === 'string' && message) return message.slice(0, 8192);
  }
  return '';
}

const names = new Set(['Error', 'TypeError', 'IntegrationError', 'ReferenceError', 'SecurityError', 'AbortError', 'InvalidStateError']);

/** Nunca registrar el objeto completo, stack, claves, secreto, direcciones ni URL. */
export function stripeDiagnostic(error: unknown, secrets: string[]) {
  let message = stripeErrorMessage(error);
  for (const secret of secrets) if (secret) message = message.split(secret).join('[REDACTED]');
  message = message
    .replace(/\b(?:authorization|cookie|set-cookie)["']?\s*[:=][^\r\n]*/gi, '[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED]')
    .replace(/\b(?:[spr]k_(?:test|live)_|cs_(?:test|live)_|pi_|seti_|sub_|cus_)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\b(?:client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|token)["']?\s*[:=]\s*["']?[^\s,"';]+/gi, '[REDACTED]')
    .replace(/\b(?=[A-Za-z0-9_-]*[0-9_-])[A-Za-z0-9_-]{24,}\b/g, '[REDACTED]');
  message = Array.from(message).map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('').slice(0, 1200);
  const name = field(error, 'name');
  const errorName = typeof name === 'string' && names.has(name) ? name : typeof error === 'string' ? 'String' : error && typeof error === 'object' ? 'Object' : 'Unknown';
  return { errorName, message };
}

