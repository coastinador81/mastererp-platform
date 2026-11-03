import './style.css'

const config = {api: import.meta.env.VITE_STOREFRONT_API_URL || '', tenant: import.meta.env.VITE_TENANT_ID || '', domain: import.meta.env.VITE_STOREFRONT_DOMAIN || location.hostname}
const state = {catalog: null, category: '', cart: new Map(), error: ''}
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

function add(id) { state.cart.set(id, (state.cart.get(id) || 0) + 1); render() }
function choose(slug) { state.category = slug; render() }
function checkout() {
  window.dispatchEvent(new CustomEvent('mastererp:checkout', {detail: {items: [...state.cart].map(([product_id, quantity]) => ({product_id, quantity})), modules: state.catalog.store.modules}}))
}

function render() {
  if (state.error) return document.querySelector('#app').innerHTML = `<main><p class="error">${escapeHtml(state.error)}</p></main>`
  if (!state.catalog) return document.querySelector('#app').innerHTML = '<main>Cargando tienda…</main>'
  const {store, categories, products} = state.catalog
  const visible = state.category ? products.filter(item => item.category_ref === state.category) : products
  const count = [...state.cart.values()].reduce((sum, item) => sum + item, 0)
  document.documentElement.style.setProperty('--brand', store.branding?.primaryColor || '#2246c7')
  document.querySelector('#app').innerHTML = `<header><h1>${escapeHtml(store.name)}</h1><button id="cart">Carrito · ${count}</button></header><nav><button data-category="">Todo</button>${categories.map(item => `<button data-category="${escapeHtml(item.slug)}">${escapeHtml(item.name)}</button>`).join('')}</nav><main><section class="hero"><small>TIENDA ONLINE</small><h2>${escapeHtml(store.configuration?.headline || 'Compra fácil, recibe como prefieras')}</h2></section><section class="products">${visible.map(item => `<article><div class="photo">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : 'Producto'}</div><small>${escapeHtml(item.brand_ref || '')}</small><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || '')}</p><footer><strong>${money(item.price)}</strong><button data-add="${item.id}" ${item.available < 1 ? 'disabled' : ''}>Agregar</button></footer></article>`).join('')}</section>${count ? `<aside><strong>${count} artículos</strong><button id="checkout">Continuar pedido</button></aside>` : ''}</main><footer class="modules">Módulos activos: ${(store.modules || []).map(escapeHtml).join(' · ') || 'tienda base'}</footer>`
  document.querySelectorAll('[data-category]').forEach(button => button.onclick = () => choose(button.dataset.category))
  document.querySelectorAll('[data-add]').forEach(button => button.onclick = () => add(button.dataset.add))
  if (count) document.querySelector('#checkout').onclick = checkout
}

load()
