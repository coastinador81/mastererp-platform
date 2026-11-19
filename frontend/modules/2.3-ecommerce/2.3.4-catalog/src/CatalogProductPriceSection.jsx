import React, {useEffect, useMemo} from 'react';
import {CatalogFormSection} from './CatalogEditorPage.jsx';
import {
  calculatedSalePrice,
  convertProductMoney,
  costTotalPlusIva,
  costTotalTaxAmountFromParts,
  fiscalCreditCost,
  fiscalDebitSale,
  financeRatesFromConfig,
  seniatIvaToDeclare,
  financeTaxFactors,
  formatPricingMoney,
  normalizeProfitMargin,
  pricingCurrencies,
  profitWithoutTax,
  salePriceWithTax,
  totalCostPrice,
} from './productPricingFinance.mjs';

export default function CatalogProductPriceSection({draft, disabled, update, applyPricingFields, financePricingConfig}) {
  const rates = useMemo(() => financeRatesFromConfig(financePricingConfig), [financePricingConfig]);
  const tax = useMemo(() => financeTaxFactors(financePricingConfig), [financePricingConfig]);
  const currency = draft.pricing_currency || 'USD';
  const salePrice = useMemo(
    () => calculatedSalePrice(draft.cost_price, draft.logistics_freight, draft.other_expenses, draft.profit_margin),
    [draft.cost_price, draft.logistics_freight, draft.other_expenses, draft.profit_margin],
  );
  const saleWithTax = useMemo(() => salePriceWithTax(salePrice, tax.sale_tax_rate), [salePrice, tax.sale_tax_rate]);
  const costTotal = useMemo(
    () => totalCostPrice(draft.cost_price, draft.logistics_freight, draft.other_expenses),
    [draft.cost_price, draft.logistics_freight, draft.other_expenses],
  );
  const costTotalIva = useMemo(
    () => costTotalTaxAmountFromParts(
      draft.cost_price,
      draft.logistics_freight,
      draft.other_expenses,
      draft.cost_price_vat_exempt,
      draft.logistics_freight_vat_exempt,
      draft.other_expenses_vat_exempt,
      tax.cost_tax_rate,
    ),
    [
      draft.cost_price,
      draft.logistics_freight,
      draft.other_expenses,
      draft.cost_price_vat_exempt,
      draft.logistics_freight_vat_exempt,
      draft.other_expenses_vat_exempt,
      tax.cost_tax_rate,
    ],
  );
  const costTotalWithIva = useMemo(() => costTotalPlusIva(costTotal, costTotalIva), [costTotal, costTotalIva]);
  const profitNoTax = useMemo(() => profitWithoutTax(salePrice, costTotal), [salePrice, costTotal]);
  const fiscalDebit = useMemo(() => fiscalDebitSale(saleWithTax, salePrice), [saleWithTax, salePrice]);
  const fiscalCredit = useMemo(() => fiscalCreditCost(costTotalIva), [costTotalIva]);
  const seniatDeclare = useMemo(() => seniatIvaToDeclare(fiscalDebit, fiscalCredit), [fiscalDebit, fiscalCredit]);

  useEffect(() => {
    const nextPrice = salePrice === '' ? '' : salePrice;
    if (nextPrice !== draft.price) update('price', nextPrice);
  }, [salePrice]); // eslint-disable-line react-hooks/exhaustive-deps -- price is derived from cost stack

  const changeCurrency = next => {
    if (next === currency) return;
    applyPricingFields({
      pricing_currency: next,
      cost_price: convertProductMoney(draft.cost_price, currency, next, rates),
      logistics_freight: convertProductMoney(draft.logistics_freight, currency, next, rates),
      other_expenses: convertProductMoney(draft.other_expenses, currency, next, rates),
    });
  };
  const numberField = (key, label, props = {}) => (
    <label key={key} className={props.wide ? 'cat-full' : undefined}>
      {label}
      <input
        name={key}
        type="number"
        min={props.min ?? 0}
        max={props.max}
        step={props.step ?? 0.000001}
        value={draft[key] ?? ''}
        disabled={disabled}
        onChange={event => update(key, event.target.value === '' ? '' : Number(event.target.value))}
        onBlur={key === 'profit_margin' ? () => update('profit_margin', normalizeProfitMargin(draft.profit_margin)) : undefined}
      />
    </label>
  );
  const calculatedField = (label, value, className = '') => (
    <label className={`cat-price-calculated${className ? ` ${className}` : ''}`}>
      {label}
      <output>{formatPricingMoney(value, currency)}</output>
    </label>
  );
  const expenseField = (amountKey, exemptKey, label) => (
    <div className="cat-price-expense" key={amountKey}>
      <label>
        {label}
        <input
          name={amountKey}
          type="number"
          min={0}
          step={0.000001}
          value={draft[amountKey] ?? ''}
          disabled={disabled}
          onChange={event => update(amountKey, event.target.value === '' ? '' : Number(event.target.value))}
        />
      </label>
      <label className="cat-price-vat-exempt">
        <input
          type="checkbox"
          checked={Boolean(draft[exemptKey])}
          disabled={disabled}
          onChange={event => update(exemptKey, event.target.checked)}
        />
        Exento de IVA
      </label>
    </div>
  );

  return (
    <CatalogFormSection title="Precio" description="Precio de venta = costo total × 100 ÷ (100 − margen %). Ejemplo: 10 USD con 25 % → 13,33 USD. Si no hay precios guardados se usan valores de ejemplo; al cambiar moneda se convierten los montos. IVA y tipo de cambio: Finanzas → Configuración.">
      <label className="cat-full cat-price-currency-field">
        Tipo de moneda
        <select value={currency} disabled={disabled} onChange={event => changeCurrency(event.target.value)}>
          {pricingCurrencies.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <div className="cat-full cat-price-expense">
        {expenseField('cost_price', 'cost_price_vat_exempt', 'Precio de costo')}
      </div>
      <div className="cat-full cat-packaging-row cat-price-expense-row">
        {expenseField('logistics_freight', 'logistics_freight_vat_exempt', 'Flete logístico')}
        {expenseField('other_expenses', 'other_expenses_vat_exempt', 'Otros gastos')}
      </div>
      <div className="cat-full cat-price-calculated-stack cat-price-calculated-stack--cost">
        {calculatedField('Precio de costo total', costTotal)}
        {calculatedField('IVA de costo total', costTotalIva)}
        {calculatedField('Precio de costo total con IVA', costTotalWithIva)}
      </div>
      {numberField('profit_margin', 'Margen de ganancia (%) sobre venta', {step: 0.01, max: 99.99, wide: true})}
      <div className="cat-full cat-price-calculated-stack">
        {calculatedField('Precio de venta (calculado)', salePrice)}
        {calculatedField('Precio de venta con IVA', saleWithTax)}
        {calculatedField('Ganancia', profitNoTax)}
      </div>
      <div className="cat-full cat-price-calculated-stack cat-price-calculated-stack--fiscal">
        {calculatedField('Crédito fiscal', fiscalCredit)}
        {calculatedField('Débito fiscal', fiscalDebit)}
        {calculatedField('A declarar ante el SENIAT (débito − crédito)', seniatDeclare, 'cat-price-calculated--seniat')}
      </div>
    </CatalogFormSection>
  );
}