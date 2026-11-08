import { parseAmount, rechargeError, rechargeQuote, splitSpend } from '../model/recharge';
import { refundAmounts, tokensSpentSince } from '../model/refund';
import type { Movement } from '../model/types';

test('recargas: interpreta importes españoles y exige el mínimo configurado', () => {
  expect(parseAmount('1.250,50 €')).toBe(1250.5);
  expect(parseAmount('20,50')).toBe(20.5);
  expect(parseAmount('-20')).toBeNull();
  expect(parseAmount('texto')).toBeNull();
  const limits = { minRecharge: 20, maxRecharge: 5000 };
  expect(rechargeError(19.99, limits)).toContain('20');
  expect(rechargeError(20, limits)).toBeNull();
  expect(rechargeError(5001, limits)).not.toBeNull();
  expect(rechargeQuote(20, { tokenPrice: 0.01, vatRate: 0.21 })).toEqual({ tokens: 2000, amounts: { base: 20, vatRate: 0.21, vat: 4.2, total: 24.2 } });
});

test('el gasto usa primero los tokens incluidos y rechaza saldo insuficiente', () => {
  const balance = { tokens: 1500, included: 500, recharged: 1000 };
  expect(splitSpend(balance, 700)).toEqual({ included: 500, recharged: 200 });
  expect(splitSpend(balance, 1501)).toBeNull();
});

test('el desistimiento no descuenta de nuevo tokens recargados aparte', () => {
  const movements: Movement[] = [
    { id: 'included', at: '2026-09-28T10:00:00Z', kind: 'spend', tokens: -300, account: 'included', concept: 'Uony' },
    { id: 'recharged', at: '2026-09-28T10:00:00Z', kind: 'spend', tokens: -200, account: 'recharged', concept: 'Uony' },
    { id: 'old', at: '2026-08-01T10:00:00Z', kind: 'spend', tokens: -100, account: 'included', concept: 'Uony' },
  ];
  expect(tokensSpentSince(movements, '2026-09-01')).toBe(300);
  const paid = { base: 100, vatRate: 0.21, vat: 21, total: 121 };
  expect(refundAmounts(paid, 1000, 0.01)).toEqual({ spentValue: 10, refund: { base: 90, vatRate: 0.21, vat: 18.9, total: 108.9 } });
  expect(refundAmounts(paid, 20000, 0.01).refund.total).toBe(0);
  expect(refundAmounts(paid, 0, 0.01).refund).toEqual(paid);
});
