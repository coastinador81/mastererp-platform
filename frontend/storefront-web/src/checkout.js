import {authorizedIdentityFetch} from '../../shared/auth/cognito.mjs'

const checkoutKey = 'mastererp.storefront.checkout-key'

function idempotencyKey() {
  let key = sessionStorage.getItem(checkoutKey)
  if (!key) {
    key = `storefront-${crypto.randomUUID()}`
    sessionStorage.setItem(checkoutKey, key)
  }
  return key
}

export async function submitCheckout(api, tenant, domain, detail) {
  const result = await authorizedIdentityFetch(`${api}/v1/storefront/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey(),
      'X-Tenant-Id': tenant,
    },
    body: JSON.stringify({domain, ...detail}),
  })
  sessionStorage.removeItem(checkoutKey)
  return result
}
