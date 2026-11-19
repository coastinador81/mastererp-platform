export const financeTaxConfigEvent = 'finance-tax-config-changed';
const storagePrefix = 'mastererp.finance.config.v1';
const legacyStoragePrefix = 'mastererp.finance.tax.v1';

export const emptyFinanceConfig = () => ({
  sale_tax_rate: '',
  cost_tax_rate: '',
  usd_exchange_rate: '',
  eur_exchange_rate: '',
});

export function financeConfigStorageKey(tenant) {
  return `${storagePrefix}:${tenant || 'default'}`;
}

export function normalizeTaxRate(value) {
  if (value === '' || value == null) return '';
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : '';
}

export function normalizeExchangeRate(value) {
  if (value === '' || value == null) return '';
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1_000_000_000 ? number : '';
}

function normalizeFinanceConfig(config) {
  const source = config && typeof config === 'object' ? config : {};
  return {
    sale_tax_rate: normalizeTaxRate(source.sale_tax_rate),
    cost_tax_rate: normalizeTaxRate(source.cost_tax_rate),
    usd_exchange_rate: normalizeExchangeRate(source.usd_exchange_rate),
    eur_exchange_rate: normalizeExchangeRate(source.eur_exchange_rate),
  };
}

function readLegacyTaxConfig(tenant) {
  try {
    const raw = localStorage.getItem(`${legacyStoragePrefix}:${tenant || 'default'}`);
    if (!raw) return null;
    return normalizeFinanceConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function readFinanceConfig(tenant) {
  try {
    const raw = localStorage.getItem(financeConfigStorageKey(tenant));
    if (!raw) {
      const legacy = readLegacyTaxConfig(tenant);
      return legacy || emptyFinanceConfig();
    }
    return normalizeFinanceConfig(JSON.parse(raw));
  } catch {
    return emptyFinanceConfig();
  }
}

export function readFinanceTaxConfig(tenant) {
  const {sale_tax_rate, cost_tax_rate} = readFinanceConfig(tenant);
  return {sale_tax_rate, cost_tax_rate};
}

export function writeFinanceConfig(tenant, config) {
  const normalized = normalizeFinanceConfig(config);
  localStorage.setItem(financeConfigStorageKey(tenant), JSON.stringify(normalized));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(financeTaxConfigEvent, {detail: {tenant, config: normalized}}));
  }
  return normalized;
}

export function writeFinanceTaxConfig(tenant, taxConfig) {
  const current = readFinanceConfig(tenant);
  return writeFinanceConfig(tenant, {...current, ...taxConfig});
}

function mergeRemoteConfig(tenant, local, response) {
  const remote = response?.data && typeof response.data === 'object' ? response.data : response;
  const tax = remote?.tax && typeof remote.tax === 'object' ? remote.tax : {};
  const exchange = remote?.exchange && typeof remote.exchange === 'object' ? remote.exchange : {};
  return writeFinanceConfig(tenant, {
    ...local,
    ...(tax.sale_tax_rate != null ? {sale_tax_rate: tax.sale_tax_rate} : {}),
    ...(tax.cost_tax_rate != null ? {cost_tax_rate: tax.cost_tax_rate} : {}),
    ...(exchange.usd_exchange_rate != null ? {usd_exchange_rate: exchange.usd_exchange_rate} : exchange.usd_rate != null ? {usd_exchange_rate: exchange.usd_rate} : {}),
    ...(exchange.eur_exchange_rate != null ? {eur_exchange_rate: exchange.eur_exchange_rate} : exchange.eur_rate != null ? {eur_exchange_rate: exchange.eur_rate} : {}),
  });
}

export async function loadFinanceConfig(runtime) {
  const local = readFinanceConfig(runtime?.tenant);
  if (!runtime?.request || !runtime?.company) return local;
  try {
    const response = await runtime.request(`${runtime.api}/v1/companies/${runtime.company}/finance/configuration`, {
      headers: {'X-Tenant-Id': runtime.tenant},
    });
    if (response && typeof response === 'object') {
      return mergeRemoteConfig(runtime.tenant, local, response);
    }
  } catch {
    // Usa copia local hasta que exista el endpoint en el entorno.
  }
  return local;
}

export async function loadFinanceTaxConfig(runtime) {
  const config = await loadFinanceConfig(runtime);
  return {sale_tax_rate: config.sale_tax_rate, cost_tax_rate: config.cost_tax_rate};
}

export async function saveFinanceConfig(runtime, config) {
  const normalized = writeFinanceConfig(runtime.tenant, config);
  if (!runtime?.request || !runtime?.company) return normalized;
  try {
    await runtime.request(`${runtime.api}/v1/companies/${runtime.company}/finance/configuration`, {
      method: 'PATCH',
      headers: {'X-Tenant-Id': runtime.tenant, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        tax: {
          sale_tax_rate: normalized.sale_tax_rate,
          cost_tax_rate: normalized.cost_tax_rate,
        },
        exchange: {
          usd_exchange_rate: normalized.usd_exchange_rate,
          eur_exchange_rate: normalized.eur_exchange_rate,
        },
      }),
    });
  } catch {
    // La configuración local ya quedó guardada.
  }
  return normalized;
}

export async function saveFinanceTaxConfig(runtime, taxConfig) {
  const current = readFinanceConfig(runtime.tenant);
  return saveFinanceConfig(runtime, {...current, ...taxConfig});
}