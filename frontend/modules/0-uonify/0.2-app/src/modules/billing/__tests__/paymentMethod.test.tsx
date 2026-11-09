import { cardNumberValid } from '../model/card';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { handlers } from '@/shared/mocks/handlers';
import { billingApi } from '../api/billingApi';
import { CheckoutDialog } from '../components/checkout/CheckoutDialog';
import { StripeCardMock, type CardEntry } from '../components/checkout/StripeCardMock';
import { cardDb, invoicesDb, resetBillingMocks } from '../mocks/store';
import { NEW_CARD } from '../mocks/fixtures/seed';

const account = vi.hoisted(() => ({ email: 'new@example.test' }));
vi.mock('@/modules/auth', async original => ({
  ...await original<typeof import('@/modules/auth')>(),
  currentAccountEmail: () => account.email,
  useSession: () => ({ user: { email: account.email }, status: 'ready', profile: null }),
}));
vi.mock('@/shared/mocks/utils', async original => ({
  ...await original<typeof import('@/shared/mocks/utils')>(), latency: () => Promise.resolve(),
}));
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => { account.email = 'new@example.test'; resetBillingMocks(); });
const request = { planId: 'basic' as const, interval: 'monthly' as const, paymentMethod: 'new', newCard: NEW_CARD, acceptedTerms: true, acceptedWithdrawal: true, termsVersion: '2026-11-09' };

function mountCheckout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><CheckoutDialog id={123} planId="basic" interval="monthly" /></QueryClientProvider>);
}
async function fillCard(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Número de tarjeta'), '1234567812344444');
  await user.type(screen.getByLabelText('Caducidad'), '1235');
  await user.type(screen.getByLabelText('CVC'), '123');
}

test('cuenta nueva y sesión antigua con tarjeta precargada empiezan sin tarjeta guardada', async () => {
  sessionStorage.setItem('uonify-mock:billing-card', JSON.stringify({ card: NEW_CARD }));
  expect(await billingApi.paymentMethod()).toBeNull();
  mountCheckout();
  expect(await screen.findByLabelText('Número de tarjeta')).toHaveValue('');
  expect(screen.getByLabelText('Caducidad')).toHaveValue('');
  expect(screen.getByLabelText('CVC')).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: /Guardar esta tarjeta/ })).not.toBeChecked();
});

test.each([false, true])('pago con elección guardar=%s: cobra la tarjeta introducida y respeta la elección', async save => {
  const user = userEvent.setup();
  mountCheckout();
  await screen.findByLabelText('Número de tarjeta');
  const before = invoicesDb.all().length;
  await user.click(screen.getByRole('checkbox', { name: /He leído y acepto/ }));
  await user.click(screen.getByRole('checkbox', { name: /Quiero que el plan empiece/ }));
  await user.click(screen.getByRole('button', { name: /^Pagar/ }));
  expect(invoicesDb.all()).toHaveLength(before);
  await fillCard(user);
  if (save) await user.click(screen.getByRole('checkbox', { name: /Guardar esta tarjeta/ }));
  await user.click(screen.getByRole('button', { name: /^Pagar/ }));
  await screen.findByText('Ya tienes el plan Básico');
  const saved = await billingApi.paymentMethod();
  if (save) expect(saved).toMatchObject({ last4: '4444', expYear: 2035 });
  else expect(saved).toBeNull();
  expect(invoicesDb.all()).toHaveLength(before + 1);
  expect(JSON.stringify(sessionStorage)).not.toContain('1234567812344444');
  expect(JSON.stringify(sessionStorage)).not.toContain('"cvc"');
});

test('una tarjeta ajena o una nueva sin datos no generan factura', async () => {
  const count = invoicesDb.all().length;
  await expect(billingApi.checkout({ ...request, newCard: undefined })).rejects.toMatchObject({ status: 400 });
  await expect(billingApi.checkout({ ...request, paymentMethod: 'pm_unknown' })).rejects.toMatchObject({ status: 400 });
  expect(invoicesDb.all()).toHaveLength(count);
  expect(await billingApi.paymentMethod()).toBeNull();
});

test('no guardar otra tarjeta conserva la anterior; cada cuenta ve solo la suya', async () => {
  const original = { ...NEW_CARD, id: 'pm_original', last4: '1234' };
  cardDb.set({ card: original });
  await billingApi.recharge(20, { paymentMethod: 'new', newCard: NEW_CARD, savePaymentMethod: false });
  expect(await billingApi.paymentMethod()).toEqual(original);
  account.email = 'another@example.test';
  expect(await billingApi.paymentMethod()).toBeNull();
  await expect(billingApi.recharge(20, { paymentMethod: original.id })).rejects.toMatchObject({ status: 400 });
  account.email = 'new@example.test';
  expect(await billingApi.paymentMethod()).toEqual(original);
});

test('recarga con guardado explícito conserva la tarjeta para siguientes pagos', async () => {
  await billingApi.recharge(20, { paymentMethod: 'new', newCard: NEW_CARD, savePaymentMethod: true });
  expect(await billingApi.paymentMethod()).toEqual(NEW_CARD);
  const result = await billingApi.recharge(20, { paymentMethod: NEW_CARD.id });
  expect(result.paymentMethod).toEqual(NEW_CARD);
});

test('añadir desde Configuración exige datos y guarda por petición explícita', async () => {
  await expect(billingApi.replacePaymentMethod({ ...NEW_CARD, last4: '' })).rejects.toMatchObject({ status: 400 });
  expect(await billingApi.paymentMethod()).toBeNull();
  await billingApi.replacePaymentMethod(NEW_CARD);
  expect(await billingApi.paymentMethod()).toEqual(NEW_CARD);
});

test('rechaza número, caducidad y CVC inválidos; devuelve solo metadatos', async () => {
  const user = userEvent.setup();
  const entry = createRef<CardEntry>();
  render(<StripeCardMock ref={entry} />);
  expect(entry.current!.read()).toBeNull();
  await fillCard(user);
  await user.clear(screen.getByLabelText('Caducidad'));
  await user.type(screen.getByLabelText('Caducidad'), '01/20');
  expect(entry.current!.read()).toBeNull();
  await user.clear(screen.getByLabelText('Caducidad'));
  await user.type(screen.getByLabelText('Caducidad'), '12/35');
  await user.clear(screen.getByLabelText('CVC'));
  expect(entry.current!.read()).toBeNull();
  await user.type(screen.getByLabelText('CVC'), '123');
  expect(entry.current!.read()).toEqual({ id: expect.stringMatching(/^pm_/), brand: 'mastercard', last4: '4444', expMonth: 12, expYear: 2035 });
});


test('formatea al escribir y acepta un número de demo sin Luhn', async () => {
  const user = userEvent.setup();
  const entry = createRef<CardEntry>();
  render(<StripeCardMock ref={entry} />);
  await fillCard(user);
  expect(screen.getByLabelText('Número de tarjeta')).toHaveValue('1234 5678 1234 4444');
  expect(screen.getByLabelText('Caducidad')).toHaveValue('12/35');
  expect(entry.current!.read()).toMatchObject({ last4: '4444', expMonth: 12, expYear: 2035 });
});

test('pegar, corregir y borrar conserva los separadores y la posición del cursor', async () => {
  const user = userEvent.setup();
  render(<StripeCardMock />);
  const number = screen.getByLabelText('Número de tarjeta') as HTMLInputElement;
  const expiry = screen.getByLabelText('Caducidad') as HTMLInputElement;
  await user.click(number); await user.paste('0000 0000 0000 0000');
  expect(number).toHaveValue('0000 0000 0000 0000');
  number.setSelectionRange(5, 6);
  await user.keyboard('9');
  expect(number).toHaveValue('0000 9000 0000 0000');
  expect(number.selectionStart).toBe(6);
  await user.keyboard('{Backspace}0');
  expect(number).toHaveValue('0000 0000 0000 0000');
  await user.click(expiry); await user.paste('1235');
  expect(expiry).toHaveValue('12/35');
  await user.keyboard('{Backspace}{Backspace}');
  expect(expiry).toHaveValue('12');
  await user.keyboard('36');
  expect(expiry).toHaveValue('12/36');
});


test('limita la tarjeta a 16 dígitos al escribir o pegar y rechaza longitudes distintas', async () => {
  const user = userEvent.setup();
  render(<StripeCardMock />);
  const number = screen.getByLabelText('Número de tarjeta');
  await user.type(number, '1234567812345678999');
  expect(number).toHaveValue('1234 5678 1234 5678');
  await user.clear(number);
  await user.paste('9876543298765432111');
  expect(number).toHaveValue('9876 5432 9876 5432');
  expect(cardNumberValid('1234567812345678')).toBe(true);
  for (const size of [13, 14, 15, 17, 18, 19]) expect(cardNumberValid('1'.repeat(size))).toBe(false);
});

test('CVC exige tres dígitos y bloquea el cuarto al escribir o pegar', async () => {
  const user = userEvent.setup();
  const entry = createRef<CardEntry>();
  render(<StripeCardMock ref={entry} />);
  await fillCard(user);
  const cvc = screen.getByLabelText('CVC');
  await user.type(cvc, '4');
  expect(cvc).toHaveValue('123');
  expect(entry.current!.read()).not.toBeNull();
  await user.clear(cvc);
  await user.paste('9876');
  expect(cvc).toHaveValue('987');
  await user.keyboard('{Backspace}');
  expect(entry.current!.read()).toBeNull();
  await user.keyboard('a');
  expect(cvc).toHaveValue('98');
  await user.keyboard('0');
  expect(entry.current!.read()).not.toBeNull();
});
