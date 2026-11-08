import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '@/shared/api/client';
import { SETTINGS_SECTIONS } from '@/modules/settings';
import { HELP_PUBLIC_PATHS } from '@/modules/help';
import { awaitRouterReady, collectConsoleErrors, expectNoCrashScreen, renderApp, seedSignedInSession, setupSmokeServer, settle, unhandledApiCalls } from './harness';

setupSmokeServer();
seedSignedInSession();
const errors = collectConsoleErrors();

async function healthy() {
  await settle();
  expectNoCrashScreen();
  expect(errors).toEqual([]);
  expect(unhandledApiCalls).toEqual([]);
}

test.each(SETTINGS_SECTIONS)('Configuración: %s carga con los contratos reales de MSW', async section => {
  const { router } = renderApp(`/espacio/configuracion/${section}`);
  await screen.findByRole('heading', { name: 'Configuración', level: 1 });
  await healthy();
  expect(router.state.location.pathname).toBe(`/espacio/configuracion/${section}`);
  expect(screen.queryByRole('alert')).toBeNull();
});

test.each(HELP_PUBLIC_PATHS)('%s contiene información pública y un único h1', async path => {
  const { router } = renderApp(path);
  await awaitRouterReady(router);
  await screen.findByRole('heading', { level: 1 });
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(router.state.location.pathname).toBe(path);
  await healthy();
});

test('la ayuda permite leer artículos desde la cabecera del espacio', async () => {
  renderApp('/espacio');
  await userEvent.click(await screen.findByRole('button', { name: 'Ayuda' }));
  expect(await screen.findByRole('dialog', { name: 'Ayuda de Uonify' })).toBeVisible();
  expect(within(screen.getByRole('dialog', { name: 'Ayuda de Uonify' })).getByRole('button', { name: 'Hablar con Uony' })).toBeVisible();
  await healthy();
});

test('el límite de plazas devuelve 402 y abre los planes sin cambiar la suscripción', async () => {
  renderApp('/espacio/configuracion/usuarios');
  await screen.findByRole('heading', { name: 'Configuración', level: 1 });
  await healthy();
  await userEvent.click(screen.getByRole('button', { name: 'Invitar' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Correo electrónico' }), 'invitado@uonify.test');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar invitación' }));
  await screen.findByRole('dialog', { name: /plan/i });
  const result = await api.get<{ subscription: { planId: string } }>('/billing/subscription');
  expect(result.subscription.planId).toBe('free');
});
