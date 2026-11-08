import { expect, it, vi } from 'vitest';

it('puede importar workspaceStore desde cero antes del compositor sin ciclo de inicialización', async () => {
  vi.resetModules();
  const { useWorkspaceStore } = await import('../hooks/workspaceStore');
  const { useComposerStore } = await import('../hooks/composerStore');
  expect(useWorkspaceStore.getState().historyEpoch).toBe(0);
  useComposerStore.getState().setStatus('Prueba de importación');
  expect(useComposerStore.getState().status).toBe('Prueba de importación');
});
