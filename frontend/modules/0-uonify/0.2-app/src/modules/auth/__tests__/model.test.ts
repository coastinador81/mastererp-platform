import { authReturnUrl, isAuthReturn, trustedAuthUrl } from '../model/authUrl';
import { PLAN_IDS, isPaidPlan, PLAN_LABELS, normalizePlan, planNote, planSuggestion } from '../model/plans';
import { checkProfile, isAdultAgeRange, parseSessionProfile, profileFromValues, valuesFromProfile } from '../model/profile';
import { accountSummary, authLinks, deriveStatus, parseSession, SIGNED_OUT } from '../model/session';
import type { Profile } from '../model/types';

const ana: Profile = {
  firstName: 'Ana',
  lastName: 'García López',
  name: 'Ana García López',
  email: 'ana@tienda.es',
  ageRange: '25-34',
  role: 'brand',
  companySize: '2-10',
  company: 'Tienda Ana',
  primaryGoal: 'catalog',
  source: 'search',
  desiredPlan: 'pro',
  billingInterval: 'monthly',
};

describe('perfil del alta', () => {
  test('solo las franjas de 18 o más confirman la mayoría de edad', () => {
    expect(['18-24', '25-34', '35-44', '45-54', '55+'].every(isAdultAgeRange)).toBe(true);
    expect(isAdultAgeRange('under18')).toBe(false);
    expect(isAdultAgeRange('')).toBe(false);
  });

  test('construye el perfil como el prototipo: recorta textos y compone el nombre', () => {
    const profile = profileFromValues({
      firstName: '  Ana ',
      lastName: ' García López ',
      email: ' ana@tienda.es ',
      ageRange: '25-34',
      role: 'brand',
      companySize: '2-10',
      company: '  Tienda Ana ',
      primaryGoal: 'catalog',
      source: '',
      plan: 'pro',
    });
    expect(profile).toEqual({ ...ana, source: '' });
  });

  test('valida los obligatorios, la edad y el plan', () => {
    expect(checkProfile(ana)).toEqual({ ok: true, profile: ana });
    expect(checkProfile({ ...ana, role: '' })).toEqual({ ok: false, reason: 'invalid' });
    expect(checkProfile({ ...ana, email: 'sin-arroba' })).toEqual({ ok: false, reason: 'invalid' });
    expect(checkProfile({ ...ana, ageRange: 'under18' })).toEqual({ ok: false, reason: 'underage' });
    expect(checkProfile({ ...ana, desiredPlan: 'gold' })).toEqual({ ok: false, reason: 'invalid' });
    expect(checkProfile(null)).toEqual({ ok: false, reason: 'invalid' });
  });

  test('rellena el alta con lo guardado y el correo de la sesión manda', () => {
    const values = valuesFromProfile(ana, 'cuenta@openai.test');
    expect(values.email).toBe('cuenta@openai.test');
    expect(values.plan).toBe('pro');
    expect(valuesFromProfile(null, '').plan).toBe('free');
  });

  test('acepta perfiles con solo «name» y traduce el plan antiguo «enterprise»', () => {
    const profile = parseSessionProfile({ name: 'Luis Pérez Gil', desiredPlan: 'enterprise' });
    expect(profile).toMatchObject({ firstName: 'Luis', lastName: 'Pérez Gil', desiredPlan: 'custom' });
    expect(parseSessionProfile({ email: 'x@y.es' })).toBeNull();
  });
});

describe('planes (decisión del dueño)', () => {
  test('planes del alta y planes que pasan por pago', () => {
    expect(PLAN_IDS).toEqual(['free', 'basic', 'pro', 'max', 'custom']);
    expect(PLAN_IDS.filter(isPaidPlan)).toEqual(['basic', 'pro', 'max']);
  });

  test('recomendación por tamaño de equipo y nota según el plan', () => {
    expect(planSuggestion('11-50')).toBe('Por el tamaño de tu equipo, te recomendamos empezar con Pro. Puedes elegir cualquier plan.');
    expect(planSuggestion('201+')).toContain('un plan Personalizado');
    expect(planSuggestion('')).toBe('');
    expect(planNote('free')).toContain('no tiene coste');
    expect(planNote('max')).toContain('Pago mensual');
    expect(planNote('max', 'annual')).toContain('Pago anual');
    expect(planNote('custom')).toContain('hola@uonify.com');
    expect(normalizePlan('basic')).toBe('basic');
    expect(normalizePlan('otro')).toBeNull();
  });
});

describe('sesión y cuenta', () => {
  test('normaliza /api/auth/session y deriva el estado', () => {
    expect(parseSession({ authenticated: false })).toBe(SIGNED_OUT);
    const onboarding = parseSession({ authenticated: true, account: { email: 'ana@tienda.es' } });
    expect(onboarding).toEqual({ ...SIGNED_OUT, authenticated: true, email: 'ana@tienda.es', profile: null, profileReady: false });
    expect(deriveStatus(onboarding)).toBe('onboarding');
    // Sin mayoría de edad confirmada no está lista, aunque el perfil esté completo.
    expect(deriveStatus(parseSession({ authenticated: true, profile: ana, profileComplete: true }))).toBe('onboarding');
    const ready = parseSession({ authenticated: true, email: 'ana@tienda.es', profile: ana, profileComplete: true, ageConfirmedAdult: true });
    expect(deriveStatus(ready)).toBe('ready');
    expect(deriveStatus(undefined)).toBe('loading');
    expect(deriveStatus(SIGNED_OUT)).toBe('signed-out');
  });

  test('menú de cuenta como refreshAccount del prototipo', () => {
    expect(accountSummary('signed-out', null)).toEqual({ name: 'Iniciar sesión', email: 'Tu espacio Uonify', initial: 'U', planLabel: 'Tu espacio Uonify' });
    expect(accountSummary('onboarding', null)).toEqual({ name: 'Completar perfil', email: 'Sesión iniciada', initial: 'U', planLabel: 'Sin plan activo' });
    expect(accountSummary('ready', ana)).toEqual({ name: 'Ana', email: 'ana@tienda.es', initial: 'A', planLabel: 'Plan Pro' });
    expect(accountSummary('ready', { ...ana, firstName: ' ', desiredPlan: 'free' })).toMatchObject({ name: 'Mi cuenta', initial: 'U', planLabel: 'Plan Gratis' });
    expect(PLAN_LABELS.max).toBe('Max');
  });

  test('resumen de «Mi cuenta» y textos de la web pública', () => {
    expect(authLinks('signed-out')).toEqual({ loginLink: 'Iniciar sesión', identityTrigger: 'Iniciar sesión', homeHref: '/', homeLabel: 'Uonify, ir al inicio' });
    expect(authLinks('onboarding').identityTrigger).toBe('Completar perfil');
    expect(authLinks('ready')).toMatchObject({ loginLink: 'Volver a mi espacio', identityTrigger: 'Ir a mi espacio', homeHref: '/espacio' });
  });
});

describe('URL de acceso', () => {
  const origin = 'https://dev.uonify.com';

  test('solo se confía en el mismo origen o en OpenAI por https', () => {
    expect(trustedAuthUrl('https://auth.openai.com/authorize?x=1', origin)?.hostname).toBe('auth.openai.com');
    expect(trustedAuthUrl('https://chatgpt.com/auth', origin)).not.toBeNull();
    expect(trustedAuthUrl('/?auth=return', origin)?.href).toBe('https://dev.uonify.com/?auth=return');
    expect(trustedAuthUrl('http://auth.openai.com/authorize', origin)).toBeNull();
    expect(trustedAuthUrl('https://auth.openai.com.evil.test/', origin)).toBeNull();
    expect(trustedAuthUrl('', origin)).toBeNull();
    expect(trustedAuthUrl(42, origin)).toBeNull();
  });

  test('vuelta de OpenAI', () => {
    expect(authReturnUrl(origin)).toBe('https://dev.uonify.com/?auth=return');
    expect(isAuthReturn('?auth=return')).toBe(true);
    expect(isAuthReturn('?auth=other')).toBe(false);
  });
});
