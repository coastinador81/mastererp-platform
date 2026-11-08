import { screen } from '@testing-library/react';
import { api } from '@/shared/api/client';
import { awaitRouterReady, collectConsoleErrors, expectNoCrashScreen, renderApp, setupSmokeServer, settle, unhandledApiCalls } from './harness';

setupSmokeServer();
const errors = collectConsoleErrors();

beforeAll(async () => {
  // Se recorre el acceso simulado completo; ningún código real sale de este test.
  const email = await api.post<{ challengeId: string; preview: { message: string } }>('/admin/auth/email/start', { email: 'laura@uonify.com' });
  const mfa = await api.post<{ mfaChallengeId: string; preview: { message: string } }>('/admin/auth/email/verify', { challengeId: email.challengeId, code: email.preview.message.match(/\b\d{6}\b/)![0] });
  const session = await api.post<{ authenticated: boolean }>('/admin/auth/mfa/verify', { mfaChallengeId: mfa.mfaChallengeId, method: 'totp', code: mfa.preview.message.match(/\b\d{6}\b/)![0] });
  expect(session.authenticated).toBe(true);
});

const pages = [
  ['/admin', 'Resumen'], ['/admin/clientes', 'Clientes'], ['/admin/planes', 'Suscripción y precios'],
  ['/admin/proveedores', 'Proveedores de IA'], ['/admin/soporte', 'Soporte'], ['/admin/articulos', 'Artículos de ayuda'],
  ['/admin/articulos/nuevo', 'Crear artículo'], ['/admin/facturacion', 'Facturación'], ['/admin/auditoria', 'Auditoría'],
];
test.each(pages)('%s abre su sección completa', async (path, title) => {
  const { router } = renderApp(path);
  await awaitRouterReady(router);
  await screen.findByRole('heading', { level: 1, name: title }, { timeout: 4000 });
  await settle();
  expectNoCrashScreen();
  expect(errors).toEqual([]);
  expect(unhandledApiCalls).toEqual([]);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('la ficha de cliente (solo lectura) abre suscripción, movimientos y notas', async () => {
  const { customers } = await api.get<{ customers: { id: string; company: string }[] }>('/admin/customers');
  renderApp(`/admin/clientes/${customers[0].id}`);
  await screen.findByRole('heading', { level: 1, name: customers[0].company });
  await settle();
  // Ficha en modo lectura (modelo de suscripción, sin tokens): no hay botón «Ajustar saldo».
  expect(screen.getByRole('heading', { name: 'Suscripción y movimientos' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Notas internas' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Ajustar saldo' })).toBeNull();
  expect(errors).toEqual([]);
});

test('el editor carga un artículo completo y soporte permite cerrar y reabrir', async () => {
  renderApp('/admin/articulos/entrar-en-uonify');
  await screen.findByRole('textbox', { name: 'Contenido (Markdown)' });
  expect(screen.getByRole('textbox', { name: 'Contenido (Markdown)' })).not.toHaveValue('');
  const ticket = await api.post<{ id: string }>('/support/tickets', { subject: 'Prueba de recuperación del soporte', message: 'No consigo guardar mi producto y necesito ayuda para revisarlo.', category: 'catalog', source: 'form' });
  const closed = await api.patch<{ status: string }>(`/support/tickets/${ticket.id}`, { status: 'closed' });
  expect(closed.status).toBe('closed');
  const opened = await api.patch<{ status: string }>(`/support/tickets/${ticket.id}`, { status: 'open' });
  expect(opened.status).toBe('open');
});
