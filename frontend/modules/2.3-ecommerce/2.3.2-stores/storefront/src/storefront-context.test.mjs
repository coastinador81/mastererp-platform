import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStorefrontContext } from './storefront-context.mjs';

const tenant = '9095f990-c1f7-4ccb-953d-f84083331bd6';
const tenantMapValue = JSON.stringify({
  'tienda-dev.uonify.com': tenant,
  'tienda-dev.tumandaito.com': tenant,
});

test('resolves the configured store by the effective browser domain', () => {
  assert.deepEqual(resolveStorefrontContext({
    browserDomain: 'TIENDA-DEV.UONIFY.COM.',
    configuredDomain: 'tienda-dev.uonify.com',
    tenantMapValue,
    defaultTenant: tenant,
  }), { domain: 'tienda-dev.uonify.com', hostDomain: 'tienda-dev.uonify.com', tenant });
});

test('keeps a legacy browser domain instead of falling back to another store domain', () => {
  assert.deepEqual(resolveStorefrontContext({
    browserDomain: 'tienda-dev.tumandaito.com',
    configuredDomain: 'tienda-dev.uonify.com',
    tenantMapValue,
    defaultTenant: tenant,
  }), { domain: 'tienda-dev.tumandaito.com', hostDomain: 'tienda-dev.tumandaito.com', tenant });
});

test('does not assign a tenant to an unknown browser domain', () => {
  assert.deepEqual(resolveStorefrontContext({
    browserDomain: 'otra-tienda.example.com',
    configuredDomain: 'tienda-dev.uonify.com',
    tenantMapValue,
    defaultTenant: tenant,
  }), { domain: 'otra-tienda.example.com', hostDomain: 'otra-tienda.example.com', tenant: '' });
});
