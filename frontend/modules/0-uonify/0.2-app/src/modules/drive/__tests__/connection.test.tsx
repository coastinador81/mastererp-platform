import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { mock } from '@/shared/mocks/utils';
import { DriveConnection } from '../components/DriveConnection';
import { driveApi, type DriveFile } from '../api/driveApi';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => server.close());
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DriveConnection account="owner@example.test" /></QueryClientProvider>);
const base = '/connections/google-drive';
const file = { id: 'file1', name: 'Ficha.txt', mimeType: 'text/plain' };
function fixtures(allowed = true) {
  let connected = true;
  let selected: DriveFile[] = [];
  server.use(
    http.get(mock(base), () => HttpResponse.json({ connection: { status: connected ? 'connected' : 'disconnected', email: 'drive@example.test' }, available: true, accessAllowed: allowed })),
    http.get(mock(base + '/files'), () => HttpResponse.json({ files: [file] })),
    http.get(mock(base + '/materials'), () => HttpResponse.json({ files: selected })),
    http.post(mock(base + '/materials'), async ({ request }) => { expect(await request.json()).toEqual({ fileId: 'file1' }); selected = [file]; return HttpResponse.json({ file }); }),
    http.delete(mock(base + '/materials/file1'), () => { selected = []; return HttpResponse.json({ removed: true }); }),
    http.delete(mock(base), () => { connected = false; return HttpResponse.json({ connection: { status: 'disconnected' } }); }),
  );
}
it('selecciona y retira referencias, y confirma desconexión sin borrar originales', async () => {
  fixtures(); const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: 'Añadir' }));
  expect(await screen.findByRole('button', { name: 'Añadido' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Mis materiales · 1' }));
  expect(screen.getByRole('link', { name: 'Descargar' })).toHaveAttribute('href', base.replace('/connections','/api/connections') + '/materials/file1/content');
  await user.click(screen.getByRole('button', { name: 'Retirar Ficha.txt' }));
  expect(await screen.findByText('Aún no has seleccionado archivos.')).toBeInTheDocument();
  await user.click(screen.getByText('Gestionar Google Drive'));
  await user.click(screen.getByRole('button', { name: 'Desconectar Drive' }));
  expect(screen.getByText('Google Drive conectado')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirmar desconexión' }));
  expect(await screen.findByRole('button', { name: 'Conectar Google Drive' })).toBeInTheDocument();
});
it('no permite subidas con la suscripción vencida', async () => {
  fixtures(false); mount();
  expect(await screen.findByRole('button', { name: 'Subir archivo a Drive' })).toBeDisabled();
});
it('conserva el identificador al reintentar una subida de resultado desconocido', async () => {
  fixtures(); const ids: string[] = [];
  vi.spyOn(driveApi, 'upload').mockImplementation(async (uploaded, id) => {
    expect(uploaded.name).toBe('Ficha.txt');
    ids.push(id);
    if (ids.length === 1) throw new Error('Conexión interrumpida');
    return { file };
  });
  const { container } = mount(); await screen.findByRole('button', { name: 'Subir archivo a Drive' });
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['producto'], 'Ficha.txt', { type: 'text/plain' })] } });
  await screen.findByText('Conexión interrumpida');
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar carga' }));
  await waitFor(() => expect(ids).toHaveLength(2)); expect(ids[0]).toBe(ids[1]);
  expect(await screen.findByText(/Archivo guardado en la carpeta Uonify/)).toBeInTheDocument();
});
