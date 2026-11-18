import assert from 'node:assert/strict';
import test from 'node:test';
import {withFinancialTrace} from './paymentView.mjs';

test('cancelled validated payments require a refund',()=>{
  const row=withFinancialTrace({order_status:'CANCELLED',payment:{status:'VALIDATED'}});
  assert.equal(row.financial_status,'REFUND_REQUIRED');
});

test('active validated payments retain their financial state',()=>{
  const row={order_status:'CONFIRMED',payment:{status:'VALIDATED'},financial_status:'PAYMENT_VALIDATED'};
  assert.equal(withFinancialTrace(row),row);
});
