import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/shared/api/queryClient';
import { api } from '@/shared/api/client';
import { DialogHost, dialog } from '@/shared/ui';
import { billingApi } from '@/modules/billing';
import { parseSession } from '../model/session';
import { setSession } from '../state/session';
import { getUi } from '../state/authUi';
import { finishAccess } from '../flows/access';
import { bootAuth, resetBoot } from '../flows/boot';
import { resetAuthModule } from '../flows/reset';
import { navigation } from '../flows/navigation';

beforeEach(() => {
  resetAuthModule(); resetBoot(); queryClient.clear();
  vi.spyOn(api, 'get').mockResolvedValue({ status: 'pending', email: 'owner@example.test', confirmationText: 'ELIMINAR',
    requestId: 'f0a1a000-1234-4567-89ab-1234567890ab', counts: { products: 0, conversations: 0, connections: 0 },
    blockers: [], canRetry: true, message: 'Tu cuenta se conserva. Vuelve a intentarlo.' });
  vi.spyOn(api, 'post'); vi.spyOn(navigation, 'go').mockImplementation(() => {});
  vi.spyOn(billingApi, 'workspaceAccess');
  setSession(parseSession({ authenticated: true, email: 'owner@example.test', accountDeletionPending: true, profileComplete: false }));
});
afterEach(() => { act(() => dialog.close()); queryClient.clear(); vi.restoreAllMocks(); });

test.each(['login', 'reload'] as const)('una eliminación pendiente con alta incompleta se recupera antes de perfil/pago: %s', async entry => {
  render(<QueryClientProvider client={queryClient}><DialogHost /></QueryClientProvider>);
  await act(async () => { if (entry === 'login') await finishAccess(); else await bootAuth(''); });
  expect(await screen.findByRole('dialog', { name: 'Eliminar cuenta' })).toBeVisible();
  expect(getUi().dialog).toBeNull(); expect(getUi().surface.active).toBe(false);
  expect(navigation.go).toHaveBeenCalledWith('/espacio/configuracion/cuenta', { replace: true });
  expect(billingApi.workspaceAccess).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
});
