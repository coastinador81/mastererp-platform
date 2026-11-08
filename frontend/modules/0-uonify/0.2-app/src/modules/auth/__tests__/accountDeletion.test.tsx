import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { DialogHost, dialog } from '@/shared/ui';
import { AccountDeletionControl } from '../components/AccountDeletionControl';
import { SIGNED_OUT } from '../model/session';
import { currentAccountEmail, setSession } from '../state/session';
import { navigation } from '../flows/navigation';
import type { AccountDeletionPreview } from '../api/accountDeletion';

const account = 'owner@example.test';
const requestId = 'f0a1a000-1234-4567-89ab-1234567890ab';
const ready: AccountDeletionPreview = { status: 'ready', email: account, confirmationText: 'ELIMINAR', requestId,
  counts: { products: 4, conversations: 7, connections: 2 }, blockers: [], canRetry: false, message: 'Puedes revisar la eliminación.' };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const signedIn = (email = account) => setSession({ ...SIGNED_OUT, authenticated: true, email, provider: 'google', profileReady: true });
const submitButton = () => screen.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' });
const input = () => screen.getByRole('textbox', { name: 'Escribe ELIMINAR para confirmar' });
async function open(presentation: 'account' | 'conversation' = 'account') {
  render(<QueryClientProvider client={queryClient}><AccountDeletionControl account={account} presentation={presentation} /><DialogHost /></QueryClientProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Eliminar cuenta' }));
  return screen.findByRole('dialog', { name: 'Eliminar cuenta' });
}

beforeEach(() => {
  queryClient.clear(); signedIn();
  vi.spyOn(api, 'get').mockResolvedValue(ready);
  vi.spyOn(api, 'post').mockResolvedValue({ status: 'deleted', redirectTo: '/' });
  vi.spyOn(navigation, 'hard').mockImplementation(() => {});
});
afterEach(() => { act(() => dialog.close()); queryClient.clear(); vi.restoreAllMocks(); });

test('mostrar la tarjeta no solicita ni borra nada; abrir solo comprueba y Escape conserva la cuenta', async () => {
  render(<QueryClientProvider client={queryClient}><AccountDeletionControl account={account} presentation="conversation" /><DialogHost /></QueryClientProvider>);
  expect(api.get).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  const opener = screen.getByRole('button', { name: 'Eliminar cuenta' });
  await userEvent.click(opener);
  await waitFor(() => expect(input()).toBeEnabled());
  expect(api.get).toHaveBeenCalledWith('/account/deletion', { signal: expect.any(AbortSignal) });
  expect(screen.getByText(/no restablece una prueba gratuita ya utilizada/)).toBeVisible();
  expect(screen.getByText(/productos de Amazon se conservarán/)).toBeVisible();
  expect(submitButton()).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus(); expect(currentAccountEmail()).toBe(account); expect(api.post).not.toHaveBeenCalled();
});

test('exige ELIMINAR exacto y evita dos envíos o cerrar durante el borrado', async () => {
  const pending = deferred<unknown>(); vi.mocked(api.post).mockReturnValue(pending.promise);
  const modal = await open(); await waitFor(() => expect(input()).toBeEnabled());
  await userEvent.type(input(), 'eliminar'); expect(submitButton()).toBeDisabled();
  await userEvent.clear(input()); await userEvent.type(input(), 'ELIMINAR');
  fireEvent.submit(modal.querySelector('form')!); fireEvent.submit(modal.querySelector('form')!);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/account/deletion', { requestId, confirmation: 'ELIMINAR', email: account }, { signal: expect.any(AbortSignal) });
  expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled();
  await userEvent.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeVisible();
  await act(async () => pending.resolve({ status: 'deleted', redirectTo: '/' }));
  await waitFor(() => expect(navigation.hard).toHaveBeenCalledWith('/'));
  expect(navigation.hard).toHaveBeenCalledTimes(1); expect(currentAccountEmail()).toBeNull();
  expect(api.post).toHaveBeenCalledTimes(1);
});

test.each([
  { ...ready, status: 'blocked', requestId: null, blockers: [{ code: 'account_busy', count: 1, message: 'Espera a que termine tu revisión.' }] },
  { ...ready, email: 'other@example.test' },
  { status: 'ready' },
])('una revisión bloqueada, de otra cuenta o inválida nunca habilita el borrado: %j', async response => {
  vi.mocked(api.get).mockResolvedValue(response);
  await open(); await waitFor(() => expect(screen.queryByText('Comprobando tu cuenta…')).not.toBeInTheDocument());
  expect(input()).toBeDisabled(); expect(submitButton()).toBeDisabled(); expect(api.post).not.toHaveBeenCalled();
});

test('un conflicto requiere comprobar de nuevo y volver a escribir la confirmación', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(409, { message: 'Espera a que termine tu revisión.' }));
  await open(); await waitFor(() => expect(input()).toBeEnabled());
  await userEvent.type(input(), 'ELIMINAR'); await userEvent.click(submitButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('Espera a que termine tu revisión.');
  expect(input()).toBeDisabled(); expect(input()).toHaveValue(''); expect(api.post).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Comprobar de nuevo' }));
  await waitFor(() => expect(input()).toBeEnabled());
  expect(submitButton()).toBeDisabled(); expect(api.get).toHaveBeenCalledTimes(2);
});

test('un resultado pendiente conserva los datos y solo reintenta por una nueva confirmación explícita', async () => {
  const pending: AccountDeletionPreview = { ...ready, status: 'pending', canRetry: true, message: 'No hemos podido confirmar la cancelación. Tu cuenta se conserva.' };
  vi.mocked(api.get).mockResolvedValueOnce(ready).mockResolvedValue(pending);
  vi.mocked(api.post).mockResolvedValue(pending);
  await open(); await waitFor(() => expect(input()).toBeEnabled());
  await userEvent.type(input(), 'ELIMINAR'); await userEvent.click(submitButton());
  await waitFor(() => expect(input()).toBeEnabled());
  expect(input()).toHaveValue(''); expect(submitButton()).toBeDisabled();
  expect(currentAccountEmail()).toBe(account); expect(navigation.hard).not.toHaveBeenCalled();
  expect(api.post).toHaveBeenCalledTimes(1);
  await userEvent.type(input(), 'ELIMINAR'); await userEvent.click(submitButton());
  expect(api.post).toHaveBeenCalledTimes(2);
  for (const call of vi.mocked(api.post).mock.calls) expect(call[1]).toEqual({ requestId, email: account, confirmation: 'ELIMINAR' });
});

test('un error al comprobar no se transforma en un borrado y permite revisar de nuevo', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(ready);
  await open(); expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
  expect(input()).toBeDisabled(); expect(api.get).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Comprobar de nuevo' }));
  await waitFor(() => expect(input()).toBeEnabled()); expect(api.post).not.toHaveBeenCalled();
});

test('una respuesta de red perdida tras confirmar obliga a consultar el estado antes de repetir', async () => {
  vi.mocked(api.post).mockRejectedValue(new TypeError('offline'));
  await open(); await waitFor(() => expect(input()).toBeEnabled());
  await userEvent.type(input(), 'ELIMINAR'); await userEvent.click(submitButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
  expect(input()).toBeDisabled(); expect(input()).toHaveValue('');
  expect(api.post).toHaveBeenCalledTimes(1); expect(navigation.hard).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Comprobar de nuevo' }));
  await waitFor(() => expect(input()).toBeEnabled());
  expect(submitButton()).toBeDisabled(); expect(api.post).toHaveBeenCalledTimes(1);
});

test.each(['get', 'post'] as const)('un cambio de cuenta invalida la respuesta tardía de %s', async method => {
  const pending = deferred<unknown>(); vi.mocked(api[method]).mockReturnValue(pending.promise);
  const modal = await open();
  if (method === 'post') {
    await waitFor(() => expect(input()).toBeEnabled());
    await userEvent.type(input(), 'ELIMINAR'); await userEvent.click(submitButton());
  } else expect(within(modal).getByText('Comprobando tu cuenta…')).toBeVisible();
  act(() => { signedIn('other@example.test'); window.dispatchEvent(new Event('uonify:identity-changed')); });
  await act(async () => pending.resolve(method === 'get' ? ready : { status: 'deleted', redirectTo: '/' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(navigation.hard).not.toHaveBeenCalled(); expect(currentAccountEmail()).toBe('other@example.test');
});
