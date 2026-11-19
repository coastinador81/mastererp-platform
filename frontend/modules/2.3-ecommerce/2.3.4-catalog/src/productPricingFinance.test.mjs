import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  calculatedSalePrice,
  catalogFinancePricingConfig,
  costTotalPlusIva,
  costTotalTaxAmount,
  costTotalTaxAmountFromParts,
  convertProductMoney,
  financeRatesFromConfig,
  fiscalCreditCostTotal,
  fiscalCreditCost,
  fiscalDebitSale,
  seniatIvaToDeclare,
  mergeProductPricingDemo,
  productPricingDemoDefaults,
  profitWithoutTax,
  salePriceWithTax,
  taxAmount,
  totalCostPrice,
  totalCostPriceWithTax,
} from './productPricingFinance.mjs';

test('tax amount and currency conversion use finance configuration', () => {
  const rates = financeRatesFromConfig({usd_exchange_rate: 50, eur_exchange_rate: 55});
  assert.equal(taxAmount(100, 16), 16);
  assert.equal(taxAmount('', 16), 0);
  assert.equal(convertProductMoney(10, 'USD', 'VES', rates), 500);
  assert.equal(convertProductMoney(500, 'VES', 'USD', rates), 10);
});

test('sale price applies stacked costs and margin then IVA', () => {
  assert.equal(calculatedSalePrice(10, 0, 0, 25), 13.333333);
  assert.equal(calculatedSalePrice(10, 2, 3, 20), 18.75);
  assert.equal(salePriceWithTax(100, 16), 116);
});

test('total cost stacks cost freight and other with optional IVA', () => {
  assert.equal(totalCostPrice(10, 2, 3), 15);
  assert.equal(costTotalTaxAmount(10, 16), 1.6);
  assert.equal(costTotalPlusIva(10, 1.6), 11.6);
  assert.equal(costTotalTaxAmount('', 16), '');
  assert.equal(costTotalTaxAmountFromParts(10, 2, 3, false, true, false, 16), 2.08);
  assert.equal(costTotalTaxAmountFromParts(10, 2, 3, false, false, false, 16), 2.4);
  assert.equal(costTotalTaxAmountFromParts(10, 2, 3, true, false, false, 16), 0.8);
  assert.equal(totalCostPriceWithTax(10, 2, 3, 16), 17.4);
  assert.equal(totalCostPrice('', '', ''), '');
  assert.equal(fiscalCreditCostTotal(17.4, 15), 2.4);
  assert.equal(profitWithoutTax(20, 15), 5);
  assert.equal(fiscalDebitSale(23.2, 20), 3.2);
  assert.equal(fiscalCreditCost(2.4), 2.4);
  assert.equal(seniatIvaToDeclare(3.2, 2.4), 0.8);
  assert.equal(seniatIvaToDeclare('', 2.4), -2.4);
});

test('demo pricing fills empty fields and converts when currency changes', () => {
  assert.deepEqual(mergeProductPricingDemo({cost_price: '', logistics_freight: '', other_expenses: '', profit_margin: ''}), productPricingDemoDefaults);
  assert.equal(mergeProductPricingDemo({...productPricingDemoDefaults, cost_price: 7}).cost_price, 7);
  const rates = financeRatesFromConfig(catalogFinancePricingConfig({}));
  assert.equal(convertProductMoney(productPricingDemoDefaults.cost_price, 'USD', 'VES', rates), 400);
  const saleUsd = calculatedSalePrice(10, 2, 3, 25);
  assert.equal(saleUsd, 20);
  assert.equal(salePriceWithTax(saleUsd, 16), 23.2);
  assert.equal(convertProductMoney(saleUsd, 'USD', 'VES', rates), 800);
});