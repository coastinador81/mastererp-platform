import { CONSENT_DOCUMENTS, TERMS_STEP_CONSENTS } from '../model/legal';
import { resumeStep, type ResumeInput } from '../model/onboarding';
import { STEP_INDEX } from '../model/options';
import { emptyProfileValues } from '../model/profile';

const accepted = TERMS_STEP_CONSENTS.map(id => ({ id, version: CONSENT_DOCUMENTS[id].version, acceptedAt: '2026-09-28T12:00:00Z' }));
const base: ResumeInput = {
  provider: 'chatgpt', values: emptyProfileValues(), consents: [],
  chatgptConnected: false, chatgptChoice: '', savedStep: STEP_INDEX.done,
};

test('un borrador anterior nunca omite las condiciones pendientes', () => {
  expect(resumeStep({ ...base, savedStep: STEP_INDEX.you })).toBe(STEP_INDEX.terms);
});

test('volver de un permiso concedido sigue al perfil; cancelarlo vuelve a condiciones', () => {
  const returning: ResumeInput = { ...base, consents: accepted, savedStep: STEP_INDEX.terms, chatgptChoice: 'connect' };
  expect(resumeStep({ ...returning, chatgptConnected: true })).toBe(STEP_INDEX.you);
  expect(resumeStep(returning)).toBe(STEP_INDEX.terms);
});

test('retoma el trabajo tras omitir voluntariamente el permiso', () => {
  expect(resumeStep({ ...base, consents: accepted, chatgptChoice: 'skip', savedStep: STEP_INDEX.work,
    values: { ...base.values, firstName: 'Ana', lastName: 'García', ageRange: '25-34' },
  })).toBe(STEP_INDEX.work);
});

test.each(['google', 'email'] as const)('%s retoma la conexión independiente con perfil completo', provider => {
  expect(resumeStep({ ...base, provider, consents: accepted, savedStep: STEP_INDEX.chatgpt,
    values: { ...base.values, firstName: 'Ana', lastName: 'García', ageRange: '25-34', role: 'brand', companySize: '2-10', primaryGoal: 'catalog' },
  })).toBe(STEP_INDEX.chatgpt);
});
