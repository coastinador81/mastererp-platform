import { clearAllReturnPreparationDrafts, clearReturnPreparationDraft, readReturnPreparationDraft,
  rememberReturnPreparationDraft, visibleReturnPreparationDrafts } from '../api/returnPreparationDraft';

const scope = { account: 'a@example.test', threadId: 'hilo-a', sku: 'BASIC', revision: 11,
  sectionId: 'auditoria' };

beforeEach(() => sessionStorage.clear());

it('recupera texto tras una nueva instancia y lo aísla por cuenta, hilo, SKU y revisión', () => {
  const answers = { benefits: 'Texto propio sin guardar', components: '48 piezas' };
  expect(rememberReturnPreparationDraft(scope, answers)).toBe(true);
  expect(sessionStorage.length).toBe(1);
  expect(readReturnPreparationDraft(scope)).toEqual(answers);
  for (const change of [{ account: 'b@example.test' }, { threadId: 'hilo-b' },
    { sku: 'OTHER' }, { revision: 12 }, { sectionId: 'otro' }]) {
    expect(readReturnPreparationDraft({ ...scope, ...change })).toBeNull();
  }
  expect(visibleReturnPreparationDrafts('b@example.test', scope.threadId, scope.sku)).toEqual([]);
  expect(visibleReturnPreparationDrafts(scope.account, scope.threadId, scope.sku)).toEqual([{ scope, answers }]);
  clearReturnPreparationDraft(scope);
  expect(sessionStorage.length).toBe(0);
});

it('conserva más de veinte ediciones sin bloquear copias posteriores', () => {
  for (let index = 0; index < 25; index += 1) {
    expect(rememberReturnPreparationDraft({ ...scope, sectionId: `apartado-${index}` },
      { benefits: `Texto ${index}` })).toBe(true);
  }
  expect(rememberReturnPreparationDraft(scope, { benefits: 'Texto nuevo' })).toBe(true);
  expect(sessionStorage.length).toBe(26);
  expect(readReturnPreparationDraft({ ...scope, sectionId: 'apartado-0' })).toEqual({ benefits: 'Texto 0' });
  clearAllReturnPreparationDrafts();
  expect(sessionStorage.length).toBe(0);
});

it('si sessionStorage rechaza una copia por cuota, conserva las anteriores y avisa al llamador', () => {
  expect(rememberReturnPreparationDraft(scope, { benefits: 'Texto anterior' })).toBe(true);
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('QuotaExceededError', 'QuotaExceededError');
  });
  expect(rememberReturnPreparationDraft({ ...scope, sectionId: 'otro' }, { benefits: 'Texto nuevo' })).toBe(false);
  expect(readReturnPreparationDraft(scope)).toEqual({ benefits: 'Texto anterior' });
  setItem.mockRestore();
});
