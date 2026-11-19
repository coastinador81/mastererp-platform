export const pricingCurrencies = [
  {value: 'VES', label: 'Bolívares (Bs)'},
  {value: 'USD', label: 'Dólares (USD)'},
  {value: 'EUR', label: 'Euros (EUR)'},
];

const demoRates = {usd: 40, eur: 43};

/** Valores de ejemplo en USD; al cambiar moneda se convierten con los tipos de cambio. */
export const productPricingDemoDefaults = {
  pricing_currency: 'USD',
  cost_price: 10,
  logistics_freight: 2,
  other_expenses: 3,
  profit_margin: 25,
};

export const catalogDemoFinanceConfig = {
  sale_tax_rate: 16,
  cost_tax_rate: 16,
  usd_exchange_rate: demoRates.usd,
  eur_exchange_rate: demoRates.eur,
};

export function mergeProductPricingDemo(pricing = {}) {
  const demo = productPricingDemoDefaults;
  return {
    pricing_currency: pricing.pricing_currency || demo.pricing_currency,
    cost_price: pricing.cost_price === '' || pricing.cost_price == null ? demo.cost_price : pricing.cost_price,
    logistics_freight: pricing.logistics_freight === '' || pricing.logistics_freight == null ? demo.logistics_freight : pricing.logistics_freight,
    other_expenses: pricing.other_expenses === '' || pricing.other_expenses == null ? demo.other_expenses : pricing.other_expenses,
    profit_margin: pricing.profit_margin === '' || pricing.profit_margin == null ? demo.profit_margin : pricing.profit_margin,
  };
}

export function catalogFinancePricingConfig(config = {}) {
  const hasAny = ['sale_tax_rate', 'cost_tax_rate', 'usd_exchange_rate', 'eur_exchange_rate'].some(
    key => config[key] !== '' && config[key] != null,
  );
  return hasAny ? config : catalogDemoFinanceConfig;
}

export function financeRatesFromConfig(config = {}) {
  const usd = Number(config.usd_exchange_rate);
  const eur = Number(config.eur_exchange_rate);
  return {
    usd: Number.isFinite(usd) && usd > 0 ? usd : demoRates.usd,
    eur: Number.isFinite(eur) && eur > 0 ? eur : demoRates.eur,
  };
}

export function financeTaxFactors(config = {}) {
  const sale = config.sale_tax_rate;
  const cost = config.cost_tax_rate;
  const saleRate = sale === '' || sale == null ? 0 : Number(sale);
  const costRate = cost === '' || cost == null ? 0 : Number(cost);
  return {
    sale_tax_rate: Number.isFinite(saleRate) ? saleRate : 0,
    cost_tax_rate: Number.isFinite(costRate) ? costRate : 0,
  };
}

export function normalizeProfitMargin(value) {
  if (value === '' || value == null) return '';
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 100 ? number : '';
}

export function pricingCostBase(cost, freight, other) {
  const parts = [cost, freight, other].map(value => (value === '' || value == null ? 0 : Number(value)));
  if (!parts.every(Number.isFinite)) return 0;
  return Number(parts.reduce((sum, value) => sum + value, 0).toFixed(6));
}

export function totalCostPrice(cost, freight, other) {
  const base = pricingCostBase(cost, freight, other);
  return base > 0 ? base : '';
}

export function totalCostPriceWithTax(cost, freight, other, costTaxRate) {
  const base = totalCostPrice(cost, freight, other);
  if (base === '') return '';
  return salePriceWithTax(base, costTaxRate);
}

export function costTotalTaxAmount(costTotal, costTaxRate) {
  if (costTotal === '') return '';
  return taxAmount(costTotal, costTaxRate);
}

function taxableCostPart(amount, vatExempt) {
  if (vatExempt) return 0;
  if (amount === '' || amount == null) return 0;
  const value = Number(amount);
  return Number.isFinite(value) ? value : NaN;
}

export function costTaxableBaseForIva(
  cost,
  freight,
  other,
  costVatExempt = false,
  freightVatExempt = false,
  otherVatExempt = false,
) {
  const costPart = taxableCostPart(cost, costVatExempt);
  const freightPart = taxableCostPart(freight, freightVatExempt);
  const otherPart = taxableCostPart(other, otherVatExempt);
  if (!Number.isFinite(costPart) || !Number.isFinite(freightPart) || !Number.isFinite(otherPart)) return '';
  const base = costPart + freightPart + otherPart;
  if (base <= 0) return '';
  return Number(base.toFixed(6));
}

export function costTotalTaxAmountFromParts(
  cost,
  freight,
  other,
  costVatExempt,
  freightVatExempt,
  otherVatExempt,
  costTaxRate,
) {
  const taxable = costTaxableBaseForIva(cost, freight, other, costVatExempt, freightVatExempt, otherVatExempt);
  if (taxable === '') return '';
  return taxAmount(taxable, costTaxRate);
}

export function costTotalPlusIva(costTotal, costIva) {
  if (costTotal === '') return '';
  const base = Number(costTotal);
  const iva = costIva === '' || costIva == null ? 0 : Number(costIva);
  if (!Number.isFinite(base) || !Number.isFinite(iva)) return '';
  return Number((base + iva).toFixed(6));
}

export function fiscalCreditCostTotal(costTotalWithTax, costTotalWithoutTax) {
  const withTax = costTotalWithTax === '' || costTotalWithTax == null ? NaN : Number(costTotalWithTax);
  const withoutTax = costTotalWithoutTax === '' || costTotalWithoutTax == null ? NaN : Number(costTotalWithoutTax);
  if (!Number.isFinite(withTax) || !Number.isFinite(withoutTax)) return '';
  return Number((withTax - withoutTax).toFixed(6));
}

export function profitWithoutTax(salePrice, costTotalWithoutTax) {
  const sale = salePrice === '' || salePrice == null ? NaN : Number(salePrice);
  const cost = costTotalWithoutTax === '' || costTotalWithoutTax == null ? NaN : Number(costTotalWithoutTax);
  if (!Number.isFinite(sale) || !Number.isFinite(cost)) return '';
  return Number((sale - cost).toFixed(6));
}

export function fiscalDebitSale(salePriceWithTax, salePriceWithoutTax) {
  const withTax = salePriceWithTax === '' || salePriceWithTax == null ? NaN : Number(salePriceWithTax);
  const withoutTax = salePriceWithoutTax === '' || salePriceWithoutTax == null ? NaN : Number(salePriceWithoutTax);
  if (!Number.isFinite(withTax) || !Number.isFinite(withoutTax)) return '';
  return Number((withTax - withoutTax).toFixed(6));
}

export function fiscalCreditCost(costIvaAmount) {
  if (costIvaAmount === '' || costIvaAmount == null) return '';
  const value = Number(costIvaAmount);
  return Number.isFinite(value) ? value : '';
}

export function seniatIvaToDeclare(fiscalDebit, fiscalCredit) {
  const hasDebit = fiscalDebit !== '' && fiscalDebit != null;
  const hasCredit = fiscalCredit !== '' && fiscalCredit != null;
  if (!hasDebit && !hasCredit) return '';
  const debit = hasDebit ? Number(fiscalDebit) : 0;
  const credit = hasCredit ? Number(fiscalCredit) : 0;
  if (!Number.isFinite(debit) || !Number.isFinite(credit)) return '';
  return Number((debit - credit).toFixed(6));
}

export function calculatedSalePrice(cost, freight, other, marginPercent) {
  const base = pricingCostBase(cost, freight, other);
  if (base <= 0) return '';
  const margin = marginPercent === '' || marginPercent == null ? 0 : Number(marginPercent);
  if (!Number.isFinite(margin) || margin < 0) return '';
  if (margin >= 100) return '';
  if (margin === 0) return base;
  return Number((base * (100 / (100 - margin))).toFixed(6));
}

export function salePriceWithTax(salePrice, saleTaxRate) {
  const sale = salePrice === '' || salePrice == null ? 0 : Number(salePrice);
  if (!Number.isFinite(sale) || sale <= 0) return 0;
  return Number((sale + taxAmount(sale, saleTaxRate)).toFixed(6));
}

export function taxAmount(amount, ratePercent) {
  const base = amount === '' || amount == null ? 0 : Number(amount);
  const rate = ratePercent === '' || ratePercent == null ? 0 : Number(ratePercent);
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(rate) || rate < 0) return 0;
  return Number((base * rate / 100).toFixed(6));
}

export function amountInVES(amount, currency, rates) {
  if (amount === '' || amount == null) return '';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  if (currency === 'VES') return value;
  if (currency === 'USD') return Number((value * rates.usd).toFixed(6));
  if (currency === 'EUR') return Number((value * rates.eur).toFixed(6));
  return value;
}

export function convertProductMoney(amount, from, to, rates) {
  if (amount === '' || amount == null) return '';
  if (from === to) return amount;
  const ves = amountInVES(amount, from, rates);
  if (ves === '') return '';
  if (to === 'VES') return ves;
  if (to === 'USD') return Number((ves / rates.usd).toFixed(6));
  if (to === 'EUR') return Number((ves / rates.eur).toFixed(6));
  return amount;
}

export function pricingEquivalents(amount, currency, rates) {
  const ves = amountInVES(amount === '' || amount == null ? 0 : amount, currency, rates);
  if (ves === '') {
    return {VES: 0, USD: 0, EUR: 0};
  }
  return {
    VES: ves,
    USD: Number((ves / rates.usd).toFixed(6)),
    EUR: Number((ves / rates.eur).toFixed(6)),
  };
}

export function amountsInAllCurrencies(amount, currency, rates) {
  return pricingEquivalents(amount, currency, rates);
}

export function formatPricingAmount(value) {
  const number = value === '' || value == null || !Number.isFinite(Number(value)) ? 0 : Number(value);
  return number.toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

export function formatPricingMoney(value, currency) {
  const unit = currency === 'VES' ? 'Bs' : currency;
  return `${formatPricingAmount(value)} ${unit}`;
}

export function formatTriCurrency(amounts) {
  return `${formatPricingMoney(amounts.VES, 'VES')} · ${formatPricingMoney(amounts.USD, 'USD')} · ${formatPricingMoney(amounts.EUR, 'EUR')}`;
}