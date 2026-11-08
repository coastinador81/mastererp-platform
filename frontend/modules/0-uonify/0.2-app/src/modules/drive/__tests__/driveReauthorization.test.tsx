import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { DriveConnectionSettings } from '../components/DriveConnectionSettings';

let account = 'one@example.test';
const popup = vi.hoisted(() => ({ open: vi.fn(), complete: null as (() => Promise<void>) | null }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => account }));
vi.mock('@/modules/cloud', () => ({ useCloudWindow: (complete: () => Promise<void>) => {
  popup.complete = complete;
  return { open: popup.open, pending: null, message: '', focus: vi.fn(), resume: vi.fn() };
} }));
beforeEach(() => {
  account = 'one@example.test'; popup.open.mockReset(); popup.complete = null;
  vi.spyOn(api, 'get').mockResolvedValue({ connection: { status: 'connected' }, available: true, accessAllowed: true });
});
afterEach(() => vi.restoreAllMocks());
const mount = (onConnected = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DriveConnectionSettings account={account} requireAuthorization onConnected={onConnected} />
  </QueryClientProvider>);
  return onConnected;
};

it('permite renovar el permiso aunque el estado anterior aún diga conectado', async () => {
  const onConnected = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Volver a autorizar Google Drive' }));
  expect(screen.queryByRole('button', { name: 'Desconectar Google Drive' })).not.toBeInTheDocument();
  expect(popup.open).toHaveBeenCalledExactlyOnceWith('authorization');
  expect(onConnected).not.toHaveBeenCalled();
  await act(async () => popup.complete?.());
  expect(onConnected).toHaveBeenCalledTimes(1);
});

it('una autorización tardía de otra identidad no reabre el flujo anterior', async () => {
  const onConnected = mount();
  await screen.findByRole('button', { name: 'Volver a autorizar Google Drive' });
  account = 'two@example.test';
  await act(async () => popup.complete?.());
  expect(onConnected).not.toHaveBeenCalled();
});
