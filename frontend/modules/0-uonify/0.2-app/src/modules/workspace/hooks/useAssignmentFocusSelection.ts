import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { ApiError } from '@/shared/api/client';
import { useOwnedRequest } from '@/shared/hooks';
import type { AssignmentReturn } from '../api/assignmentReturn';
import { assignmentFocusStorageState, clearAssignmentFocusIntent, clearInvalidAssignmentFocusIntent,
  prepareAssignmentFocusIntent, readAssignmentFocusIntent, submitAssignmentFocus } from '../api/assignmentFocusIntent';
import { rememberExpectedAssignmentFocus } from '../api/assignmentFocusExpectation';
import { useWorkspaceStore } from './workspaceStore';

type FocusState = 'idle' | 'busy' | 'uncertain' | 'conflict';

export function useAssignmentFocusSelection(account: string, threadId: string,
  view: AssignmentReturn | null | undefined, onComplete: () => void) {
  const owned = useOwnedRequest(account, currentAccountEmail);
  const client = useQueryClient();
  const [state, setState] = useState<FocusState>('idle');
  const [notice, setNotice] = useState('');
  const persisted = readAssignmentFocusIntent(account, threadId);
  const active = () => owned.current() && useWorkspaceStore.getState().historyAccount === account
    && useWorkspaceStore.getState().activeThreadId === threadId;

  const choose = async (assignmentId: string) => {
    if (!active() || !view || state === 'busy' || state === 'conflict') return;
    const storageState = assignmentFocusStorageState(account, threadId);
    const saved = readAssignmentFocusIntent(account, threadId);
    if (storageState === 'invalid' || storageState === 'unavailable') {
      setState('conflict');
      setNotice(storageState === 'invalid'
        ? 'No podemos leer una selección anterior. Actualiza el estado antes de volver a elegir.'
        : 'No podemos guardar ni comprobar la selección en este navegador. Vuelve a consultar su estado.');
      return;
    }
    if (!view.assignments.some(item => item.assignment.id === assignmentId)
      && saved?.assignmentId !== assignmentId) return;
    if (saved && saved.assignmentId !== assignmentId) {
      setState('uncertain');
      setNotice('Hay una selección anterior por comprobar. Confírmala antes de elegir otro encargo.');
      return;
    }
    const current = saved ?? prepareAssignmentFocusIntent(account, threadId, assignmentId, view.focusVersion);
    if (!current) {
      setState('conflict');
      setNotice('No podemos conservar esta selección para comprobarla. Actualiza el estado antes de intentarlo de nuevo.');
      return;
    }
    setState('busy'); setNotice('');
    try {
      // El mismo UUID se reenvía tras un timeout; el servidor devuelve el efecto original y el foco vigente.
      const result = await owned.read(signal => submitAssignmentFocus(current, signal));
      if (!active()) return;
      void client.invalidateQueries({ queryKey: ['uony-assignment-return', account, threadId] });
      if (result.appliedId !== assignmentId || result.currentId !== assignmentId) {
        clearAssignmentFocusIntent(current);
        setState('conflict');
        setNotice('Otro cambio dejó un encargo distinto en foco. Consulta el estado actualizado antes de continuar.');
        return;
      }
      if (!rememberExpectedAssignmentFocus(account, threadId, assignmentId, result.version)) {
        setState('uncertain');
        setNotice('El encargo está seleccionado, pero no podemos vincular con seguridad tu próximo mensaje. Conservamos la misma solicitud para comprobarla.');
        return;
      }
      clearAssignmentFocusIntent(current);
      setState('idle'); onComplete();
    } catch (error) {
      if (!active()) return;
      const definitive = error instanceof ApiError && [400, 401, 403, 404, 409, 410, 422].includes(error.status);
      if (definitive) {
        clearAssignmentFocusIntent(current);
        setState('conflict');
        setNotice('El encargo o el foco cambió. No hemos seleccionado otro; consulta los datos actuales.');
        void client.invalidateQueries({ queryKey: ['uony-assignment-return', account, threadId] });
      } else {
        setState('uncertain');
        setNotice('No podemos confirmar si quedó seleccionado. Conservamos la misma solicitud para comprobarla sin duplicarla.');
      }
    }
  };

  const clearConflict = () => {
    if (!active()) return;
    if (assignmentFocusStorageState(account, threadId) === 'invalid') clearInvalidAssignmentFocusIntent(account, threadId);
    const stillInvalid = assignmentFocusStorageState(account, threadId) === 'invalid';
    if (!stillInvalid) { setState('idle'); setNotice(''); }
  };

  return { choose, clearConflict, busy: state === 'busy', lockedId: persisted?.assignmentId ?? null,
    uncertain: state === 'uncertain' || !!persisted, conflict: state === 'conflict', notice };
}
