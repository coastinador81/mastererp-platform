import { render, screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { queryClient } from '@/shared/api/queryClient';
import { AuthDialogs, openAccount, openSignIn, useAccountSummary, useSession } from '../index';
import { resetAuthModule } from '../flows/reset';
import { navigation } from '../flows/navigation';
import { resetAuthDb } from '../mocks/authDb';

/** Tiempos cortos: los mensajes se ven lo justo para comprobarlos. */
export const FAST = { message: 30, ready: 250, workspaceTimeout: 3000, watchdog: 10000, leave: 10, leaveReduced: 10, reveal: 10 };

export function resetAll(): ReturnType<typeof vi.fn> {
  sessionStorage.clear();
  resetAuthDb();
  resetAuthModule(FAST);
  const hard = vi.fn();
  navigation.hard = hard;
  return hard;
}

function Probe() {
  const { pathname, search } = useLocation();
  const { status } = useSession();
  return (
    <>
      <output data-testid="location">{`${pathname}${search}`}</output>
      <output data-testid="status">{status}</output>
    </>
  );
}

function Home() {
  return (
    <main>
      <AuthDialogs />
      <Probe />
      <h1>Portada</h1>
      <button type="button" onClick={() => void openSignIn()}>
        Iniciar sesión
      </button>
    </main>
  );
}

function Workspace() {
  const summary = useAccountSummary();
  return (
    <section id="app-shell">
      <AuthDialogs />
      <Probe />
      <textarea id="composer-text" aria-label="Escribe tu petición" />
      <output data-testid="account">{`${summary.name}|${summary.email}|${summary.initial}|${summary.planLabel}`}</output>
      <button type="button" onClick={() => void openAccount()}>
        Ajustes de la cuenta
      </button>
    </section>
  );
}

/** App mínima: portada y espacio, cada uno con su <AuthDialogs/> (como las maquetaciones). */
export function renderAuthApp(initial = '/') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <Home /> },
      { path: '/espacio', element: <Workspace /> },
      { path: '/espacio/configuracion/cuenta', element: <><Probe /><h1>Configuración</h1></> },
    ],
    { initialEntries: [initial] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

export const locationText = () => screen.getByTestId('location').textContent;

/** «Continuar con ChatGPT» y elegir la cuenta en «Conecta tu cuenta». */
export async function connectAs(user: UserEvent, email: string) {
  await user.click(screen.getByRole('button', { name: 'Continuar con ChatGPT' }));
  const connect = await screen.findByRole('dialog', { name: 'Continúa en Uonify' });
  await user.type(within(connect).getByLabelText('Correo electrónico'), email);
  await user.click(within(connect).getByRole('button', { name: 'Continuar' }));
}

/** Completa el alta con ChatGPT y entra en el espacio. */
export async function completeProfile(user: UserEvent, plan: RegExp = /^Gratis/) {
  await screen.findByRole('dialog', { name: /Condiciones de Uonify|Empecemos por ti/ });
  if (screen.queryByRole('dialog', { name: 'Condiciones de Uonify' })) await completeConsents(user);
  await completePersonalDetails(user);
  await screen.findByRole('dialog', { name: 'Elige tu plan' });
  await user.click(screen.getByRole('radio', { name: plan }));
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await user.click(screen.getByRole('button', { name: 'Entrar en mi espacio' }));
}

/** Las aceptaciones se dan explícitamente en la interfaz; el permiso de ChatGPT es independiente. */
export async function completeConsents(user: UserEvent) {
  const terms = within(await screen.findByRole('dialog', { name: 'Condiciones de Uonify' }));
  for (const check of terms.getAllByRole('checkbox')) await user.click(check);
  await user.click(terms.getByRole('button', { name: 'Aceptar y continuar' }));
}

/** Datos personales y de trabajo comunes a todos los proveedores. */
export async function completePersonalDetails(user: UserEvent) {
  await screen.findByRole('dialog', { name: 'Empecemos por ti' });
  await user.type(screen.getByLabelText('Nombre'), 'Ana');
  await user.type(screen.getByLabelText('Apellidos'), 'García');
  await user.selectOptions(screen.getByLabelText('Franja de edad'), '25-34');
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  const work = await screen.findByRole('dialog', { name: 'Conozcamos tu trabajo' });
  await user.selectOptions(within(work).getByLabelText('Tu actividad'), 'brand');
  await user.selectOptions(within(work).getByLabelText('Tamaño del equipo'), '11-50');
  await user.selectOptions(within(work).getByLabelText('¿Qué quieres hacer primero?'), 'catalog');
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
}
