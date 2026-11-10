export function savedSelection(storage = sessionStorage) {
  try {
    const value = JSON.parse(storage.getItem('mastererp.dev.selection') || '{}');
    return {
      tenant: typeof value.tenant === 'string' ? value.tenant : '',
      company: typeof value.company === 'string' ? value.company : '',
    };
  } catch {
    return {tenant: '', company: ''};
  }
}

export function validSpaces(result) {
  return Array.isArray(result?.spaces) && result.spaces.every(space =>
    typeof space.id === 'string' && typeof space.name === 'string');
}

export function validContext(context, tenant) {
  return context?.tenant_id === tenant &&
    Array.isArray(context.companies) && context.companies.every(company =>
      typeof company.id === 'string' && typeof company.name === 'string') &&
    Array.isArray(context.permissions) && context.permissions.every(permission => typeof permission === 'string') &&
    Array.isArray(context.modules) && context.modules.every(module => typeof module === 'string');
}

export function selectedCompany(context, preferred = '') {
  if (context.companies.some(company => company.id === preferred)) return preferred;
  return context.companies.length === 1 ? context.companies[0].id : '';
}
