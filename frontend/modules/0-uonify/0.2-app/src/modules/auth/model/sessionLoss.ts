import { queryClient } from '@/shared/api/queryClient';
import { clearAuthStorage } from './storage';
import { clearDeletedAccountStorage } from './deletedAccountStorage';

/** Solo una respuesta explícita de sesión cerrada retira los datos privados locales. */
export function clearConfirmedSessionLoss(account: string): void {
  clearAuthStorage();
  window.dispatchEvent(new CustomEvent('uonify:identity-changed', { detail: { email: null } }));
  clearDeletedAccountStorage(account);
  // La propia consulta de sesión debe terminar normalmente, sin cancelarse ni repetirse.
  queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'auth' });
}
