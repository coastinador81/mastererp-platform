function normalizeDomain(value = '') {
  return value.trim().toLocaleLowerCase('en-US').replace(/:\d+$/, '').replace(/\.$/, '');
}

function parseTenantMap(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([domain, tenant]) =>
      typeof tenant === 'string' ? [[normalizeDomain(domain), tenant.trim()]] : [],
    ));
  } catch {
    return {};
  }
}

export function resolveStorefrontContext({ browserDomain, configuredDomain, tenantMapValue, defaultTenant }) {
  const normalizedBrowserDomain = normalizeDomain(browserDomain);
  const normalizedConfiguredDomain = normalizeDomain(configuredDomain);
  const domain = normalizedBrowserDomain || normalizedConfiguredDomain;
  const tenantsByDomain = parseTenantMap(tenantMapValue);
  const tenant = tenantsByDomain[domain]
    || (!normalizedBrowserDomain && domain === normalizedConfiguredDomain ? defaultTenant.trim() : '');

  return { domain, hostDomain: domain, tenant };
}
