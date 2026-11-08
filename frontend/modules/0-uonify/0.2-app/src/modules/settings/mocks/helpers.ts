import { isSixDigitCode, maskPhone } from '../model/security';
import type { MfaStatus } from '../model/types';
import { accountRecord, mfaRecord, type MfaState } from './store';

/** Utilidades de los handlers de Configuración. */

export async function readJson<T extends object>(request: Request): Promise<Partial<T>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Partial<T>) : {};
}

export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Código de verificación simulado: vale cualquier código de 6 cifras menos
 * «000000», que sirve para probar el caso de código incorrecto.
 */
export function mockCodeIsValid(code: unknown): boolean {
  return typeof code === 'string' && isSixDigitCode(code) && code !== '000000';
}

export function mfaStatus(state: MfaState = mfaRecord.get()): MfaStatus {
  const total = state.recovery.codes.length;
  return {
    enabled: state.totp.enabled || state.sms.enabled,
    totp: { enabled: state.totp.enabled, addedAt: state.totp.addedAt },
    sms: { enabled: state.sms.enabled, phoneMasked: state.sms.phone ? maskPhone(state.sms.phone) : null, addedAt: state.sms.addedAt },
    recoveryCodes: { remaining: Math.max(0, total - state.recovery.used), total, generatedAt: state.recovery.generatedAt },
    recoveryEmail: accountRecord.get().email,
  };
}

/** Contenido de un archivo en base64 (para guardar la foto como data URL). */
export async function fileToDataUrl(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export const DAY_MS = 86_400_000;
export const nowIso = () => new Date().toISOString();
export const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
