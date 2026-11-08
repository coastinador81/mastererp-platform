import { StrictMode, type ComponentType } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoogleCloudConnection } from '@/modules/cloud';
import { DriveConnectionSettings } from '@/modules/drive';
import { BlenderConnectionSettings } from '@/modules/blender';
import { api } from '@/shared/api/client';

const identity = vi.hoisted(() => ({ account: 'owner@example.test' }));
vi.mock('@/modules/auth', () => ({ currentAccountEmail: () => identity.account }));
const connected = {
  connection: { status: 'connected', email: 'owner@example.test', projectId: 'project-one', checks: { ready: true, billing: 'enabled', vertex: 'enabled', permissions: 'enabled' } },
  available: true, accessAllowed: true,
  status: 'connected', deviceName: 'Mac', blenderVersion: '5.2', lastSeenAt: null,
  costPolicy: { execution: 'local', billing: 'included_subscription', extraCharge: 0 },
};
const entries: { name: string; Component: ComponentType<{ account: string }>; disconnect: string; method: 'delete' | 'post'; connectedLabel: string }[] = [
  { name: 'Cloud', Component: GoogleCloudConnection, disconnect: 'Desconectar Google', method: 'delete', connectedLabel: 'Cuenta de Google conectada' },
  { name: 'Drive', Component: DriveConnectionSettings, disconnect: 'Desconectar Google Drive', method: 'delete', connectedLabel: 'Conectado' },
  { name: 'Blender', Component: BlenderConnectionSettings, disconnect: 'Desconectar Blender', method: 'post', connectedLabel: 'Conectado' },
];
beforeEach(() => { identity.account = 'owner@example.test'; });
afterEach(() => vi.restoreAllMocks());

it.each(entries)('$name conserva su consulta inicial al repetir efectos con StrictMode', async ({ Component, connectedLabel }) => {
  vi.spyOn(api, 'get').mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(connected as never), 5)));
  render(<StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Component account={identity.account} /></QueryClientProvider></StrictMode>);
  await screen.findByText(connectedLabel);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText(/No hemos podido recuperar/)).not.toBeInTheDocument();
});

it.each(entries)('$name no refresca ni muestra una respuesta tardía bajo la cuenta siguiente', async ({ name, Component, disconnect, method }) => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(connected);
  let finish: (value: never) => void = () => {};
  const mutation = vi.spyOn(api, method).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Component account={identity.account} /></QueryClientProvider>);
  if (name === 'Cloud') fireEvent.click(await screen.findByText('Gestionar la conexión'));
  fireEvent.click(await screen.findByRole('button', { name: disconnect }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar desconexión' }));
  await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
  const options = mutation.mock.calls[0][method === 'post' ? 2 : 1] as { signal: AbortSignal };
  act(() => { identity.account = 'new@example.test'; window.dispatchEvent(new Event('uonify:identity-changed')); });
  expect(options.signal.aborted).toBe(true);
  await act(async () => { finish({} as never); });
  expect(get).toHaveBeenCalledOnce();
  expect(screen.queryByText(/se ha desconectado|ha eliminado esta conexión/)).not.toBeInTheDocument();
});
