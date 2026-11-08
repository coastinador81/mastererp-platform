import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { handlers } from '@/shared/mocks/handlers';
import { mock } from '@/shared/mocks/utils';
import { openSignIn } from '../index';
import { CONSENT_DOCUMENTS, TERMS_STEP_CONSENTS } from '../model/legal';
import type { SessionPayload } from '../model/types';
import { renderAuthApp, resetAll } from './harness';
import { getUi } from '../state/authUi';

const server = setupServer(...handlers);
let saved: SessionPayload;
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  resetAll();
  saved = { authenticated: true, email: 'profile@example.test', account: { provider: 'google' }, identity: { name: 'Ana García' }, onboardingStage: 'profile', onboarding: { step: 'terms' }, profileComplete: false, consents: [] };
  server.use(http.get(mock('/auth/session'), () => HttpResponse.json(saved)), http.get(mock('/billing/workspace-access'), () => HttpResponse.json({status:'subscription_required'}))); 
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fillWork = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(screen.getByLabelText('Tu actividad'), 'seller');
  await user.selectOptions(screen.getByLabelText('Tamaño del equipo'), '1');
  await user.selectOptions(screen.getByLabelText('¿Qué quieres hacer primero?'), 'catalog');
  await user.click(screen.getByRole('button', { name: 'Guardar mis datos' }));
};

test('guarda cada paso, conserva el perfil al reabrir y no activa planes ni el espacio', async () => {
  const user = userEvent.setup();
  server.use(
    http.post(mock('/onboarding/terms'), async ({ request }) => {
      expect(await request.json()).toEqual({ consents: TERMS_STEP_CONSENTS.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version })) });
      saved = { ...saved, onboarding: { step: 'you' }, consents: TERMS_STEP_CONSENTS.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version, acceptedAt: '2026-10-09T12:00:00Z' })) };
      return HttpResponse.json(saved);
    }),
    http.post(mock('/onboarding/you'), async ({ request }) => {
      expect(await request.json()).toEqual({ firstName: 'Ana', lastName: 'García', ageRange: '25-34' });
      saved = { ...saved, profile: { firstName: 'Ana', lastName: 'García', ageRange: '25-34' }, ageConfirmedAdult: true, onboarding: { step: 'work' } };
      return HttpResponse.json(saved);
    }),
    http.post(mock('/onboarding/work'), async ({ request }) => {
      expect(await request.json()).toEqual({ role: 'seller', companySize: '1', company: '', primaryGoal: 'catalog', source: '' });
      saved = { ...saved, profile: { ...saved.profile, role: 'seller', companySize: '1', primaryGoal: 'catalog' }, onboarding: { step: 'pending' } };
      return HttpResponse.json(saved);
    }),
  );
  renderAuthApp();
  const terms = within(await screen.findByRole('dialog', { name: 'Condiciones de Uonify' }));
  for (const checkbox of terms.getAllByRole('checkbox')) {
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
  }
  await user.click(terms.getByRole('button', { name: 'Aceptar y continuar' }));
  await screen.findByRole('dialog', { name: 'Empecemos por ti' });
  expect(screen.getByLabelText('Nombre')).toHaveValue('Ana');
  expect(within(screen.getByRole('dialog', { name: 'Empecemos por ti' })).getByLabelText('Correo electrónico')).toHaveAttribute('readonly');
  await user.selectOptions(screen.getByLabelText('Franja de edad'), '25-34');
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('dialog', { name: 'Conozcamos tu trabajo' });
  await fillWork(user);
  await screen.findByRole('dialog', { name: 'Tu suscripción' });
  expect(screen.getByTestId('status')).toHaveTextContent('onboarding');
  expect(screen.queryByText('Elige tu plan')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Guardar y salir' }));
  await act(() => openSignIn());
  await screen.findByRole('dialog', { name: 'Tu suscripción' });
  await user.click(screen.getByRole('button', { name: 'Revisar mis datos' }));
  expect(screen.getByLabelText('Tu actividad')).toHaveValue('seller');
});

test('un fallo no avanza y permite reintentar; al reabrir manda el estado del servidor', async () => {
  const user = userEvent.setup();
  saved = { ...saved, onboarding: { step: 'work' }, profile: { firstName: 'Ana', lastName: 'García', ageRange: '25-34' } };
  server.use(http.post(mock('/onboarding/work'), () => HttpResponse.json({ message: 'No se ha podido guardar.' }, { status: 503 })));
  renderAuthApp();
  await screen.findByRole('dialog', { name: 'Conozcamos tu trabajo' });
  await fillWork(user);
  expect(await screen.findByText('No se ha podido guardar.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Guardar mis datos' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Cerrar el alta' }));
  await act(() => openSignIn());
  await screen.findByRole('dialog', { name: 'Conozcamos tu trabajo' });
  expect(screen.getByLabelText('Tu actividad')).toHaveValue('');
});


test('la suscripción confirmada abre Google en una pantalla independiente y permite volver', async () => {
  const user=userEvent.setup();
  saved={...saved,onboarding:{step:'pending'}};
  server.use(
    http.get(mock('/billing/workspace-access'),()=>HttpResponse.json({status:'allowed'})),
    http.get(mock('/connections/google-drive'),()=>HttpResponse.json({connection:{status:'disconnected'},available:true,accessAllowed:true})),
    http.get(mock('/connections/google-cloud'),()=>HttpResponse.json({connection:{status:'connected',email:'cloud@example.test'},available:true,accessAllowed:true})),
    http.get(mock('/billing/onboarding-offer'),()=>HttpResponse.json({offer:{annualCents:11880,monthlyCents:990,version:'v1',currency:'EUR',trialDays:14,reminderDays:3},subscription:{status:'trialing',cancelAtPeriodEnd:false,interval:'monthly',trialEndsAt:'2099-10-23T00:00:00Z',periodEndsAt:'2099-10-23T00:00:00Z'}})),
    http.post(mock('/billing/checkout-status'),()=>HttpResponse.json({access:{status:'allowed'},subscription:{status:'trialing'}})),
  );
  renderAuthApp();
  await screen.findByRole('dialog',{name:'Conecta tus herramientas'});
  expect(screen.queryByRole('region',{name:'Estado de tu suscripción'})).not.toBeInTheDocument();
  expect(await screen.findByRole('button',{name:'Ahora no, más adelante'})).toBeVisible();
  await user.click(screen.getByRole('button',{name:'IA con Google'}));
  expect(await screen.findByText('cloud@example.test')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'← Suscripción'}));
  await screen.findByRole('dialog',{name:'Tu suscripción'});
  expect(screen.queryByRole('region',{name:'Conexión con Google Cloud'})).not.toBeInTheDocument();
  await user.click(await screen.findByRole('button',{name:'Continuar con Uony'}));
  await screen.findByRole('dialog',{name:'Conecta tus herramientas'});
});

test('finaliza en backend y abre el espacio sin exigir Drive', async () => {
  const user=userEvent.setup();
  saved={...saved,onboarding:{step:'pending'},ageConfirmedAdult:true,profile:{firstName:'Ana',lastName:'García',ageRange:'25-34'}};
  server.use(
    http.get(mock('/billing/workspace-access'),()=>HttpResponse.json({status:'allowed'})),
    http.get(mock('/connections/google-drive'),()=>HttpResponse.json({connection:{status:'disconnected'},available:true,accessAllowed:true})),
    http.post(mock('/connections/google-drive/defer'),()=>HttpResponse.json({onboardingDeferred:true})),
    http.post(mock('/onboarding/complete'),()=>{saved={...saved,profileComplete:true};return HttpResponse.json(saved);}),
  );
  renderAuthApp();
  await user.click(await screen.findByRole('button',{name:'Ahora no, más adelante'}));
  await screen.findByRole('textbox',{name:'Escribe tu petición'});
  expect(screen.getByTestId('status')).toHaveTextContent('ready');
  expect(screen.getByTestId('location')).toHaveTextContent('/espacio');
  expect(document.querySelector('dialog[open]')).not.toBeInTheDocument();
  expect(getUi().surface.active).toBe(false);
});
