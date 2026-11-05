import './style.css'
import authConfig from '../auth-config.json'
import {authorizedIdentityFetch, completeLogin, login, logout, sessionExpiresAt} from '../../shared/auth/cognito.mjs'
import {submitCheckout} from './checkout.js'

const config = {api: import.meta.env.VITE_STOREFRONT_API_URL || '', tenant: import.meta.env.VITE_TENANT_ID || '', domain: import.meta.env.VITE_STOREFRONT_DOMAIN || location.hostname}
const state = {catalog: null, category: '', cart: new Map(), error: '', notice: '', authenticated: false, submitting: false}
const cartKey = 'mastererp.storefront.cart'
const invitationKey = 'mastererp.storefront.invitation'
const money = value => new Intl.NumberFormat('es-VE', {style: 'currency', currency: 'USD'}).format(value)
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))

async function load() {
  try {
    const response = await fetch(`${config.api}/v1/storefront/catalog?domain=${encodeURIComponent(config.domain)}`, {headers: {'X-Tenant-Id': config.tenant}})
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.message || 'No se pudo abrir la tienda.')
    state.catalog = body
  } catch (error) { state.error = error.message }
  render()
}

function saveCart() { sessionStorage.setItem(cartKey, JSON.stringify([...state.cart])) }
function add(id) { state.cart.set(id, (state.cart.get(id) || 0) + 1); saveCart(); render() }
function choose(slug) { state.category = slug; render() }
function startLogin() { saveCart(); return login(authConfig) }
async function checkout() {
  if (!state.authenticated) return startLogin()
  const address = document.querySelector('#delivery-address')?.value.trim()
  if (!address) { state.error = 'Indica la dirección de entrega.'; return render() }
  const detail = {
    items: [...state.cart].map(([product_id, quantity]) => ({product_id, quantity})),
    delivery: {address}, delivery_method: 'realtime', payment_method: 'cash',
  }
  window.dispatchEvent(new CustomEvent('mastererp:checkout', {detail}))
  state.submitting = true; state.error = ''; render()
  try {
    const order = await submitCheckout(config.api, config.tenant, config.domain, detail)
    state.cart.clear(); saveCart(); state.notice = `Pedido ${order.number} creado correctamente.`
  } catch (error) {
    state.error = error.status === 409 ? 'No hay inventario suficiente para completar el pedido.' : 'No se pudo crear el pedido.'
  } finally { state.submitting = false; render() }
}

async function claimInvitation() {
  const invitation = sessionStorage.getItem(invitationKey)
  if (!invitation || !state.authenticated) return
  await authorizedIdentityFetch(`${config.api}/v1/storefront/identity/claim`, {method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Tenant-Id': config.tenant},
    body: JSON.stringify({invitation_token: invitation})})
  sessionStorage.removeItem(invitationKey)
}

function render() {
  if (!state.catalog) return document.querySelector('#app').innerHTML = '<main>Cargando tienda…</main>'
  const {store, categories, products} = state.catalog
  const visible = state.category ? products.filter(item => item.category_ref === state.category) : products
  const count = [...state.cart.values()].reduce((sum, item) => sum + item, 0)
  document.documentElement.style.setProperty('--brand', store.branding?.primaryColor || '#2246c7')
  document.querySelector('#app').innerHTML = `<header><h1>${escapeHtml(store.name)}</h1><div class="account"><button id="session">${state.authenticated?'Salir':'Acceder'}</button><button id="cart">Carrito · ${count}</button></div></header><nav><button data-category="">Todo</button>${categories.map(item => `<button data-category="${escapeHtml(item.slug)}">${escapeHtml(item.name)}</button>`).join('')}</nav><main>${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}${state.notice ? `<p>${escapeHtml(state.notice)}</p>` : ''}<section class="hero"><small>TIENDA ONLINE</small><h2>${escapeHtml(store.configuration?.headline || 'Compra fácil, recibe como prefieras')}</h2></section><section class="products">${visible.map(item => `<article><div class="photo">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : 'Producto'}</div><small>${escapeHtml(item.brand_ref || '')}</small><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || '')}</p><footer><strong>${money(item.price)}</strong><button data-add="${item.id}" ${item.available < 1 ? 'disabled' : ''}>Agregar</button></footer></article>`).join('')}</section>${count ? `<aside><strong>${count} artículos</strong>${state.authenticated ? '<input id="delivery-address" autocomplete="street-address" maxlength="300" placeholder="Dirección de entrega">' : ''}<button id="checkout" ${state.submitting?'disabled':''}>${state.authenticated?(state.submitting?'Creando pedido…':'Crear pedido'):'Acceder para continuar'}</button></aside>` : ''}</main><footer class="modules">Módulos activos: ${(store.modules || []).map(escapeHtml).join(' · ') || 'tienda base'}</footer>`
  document.querySelectorAll('[data-category]').forEach(button => button.onclick = () => choose(button.dataset.category))
  document.querySelectorAll('[data-add]').forEach(button => button.onclick = () => add(button.dataset.add))
  if (count) document.querySelector('#checkout').onclick = checkout
  document.querySelector('#session').onclick = () => state.authenticated ? logout(authConfig) : startLogin()
}

async function boot() {
  try {
    const invitation = new URL(location.href).searchParams.get('invite')
    if (invitation) {
      sessionStorage.setItem(invitationKey, invitation)
      window.history.replaceState(null, '', location.pathname + location.hash)
    }
    try { state.cart = new Map(JSON.parse(sessionStorage.getItem(cartKey) || '[]')) } catch { sessionStorage.removeItem(cartKey) }
    if (location.pathname === '/auth/callback') await completeLogin(authConfig)
    else if (sessionStorage.getItem('mastererp.dev.returning') === 'true') return startLogin()
    state.authenticated = sessionExpiresAt() > Date.now()
    await claimInvitation()
  } catch { state.error = 'No se pudo validar el acceso. Intenta nuevamente.' }
  await load()
}
boot()
