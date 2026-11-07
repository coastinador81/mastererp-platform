import './style.css'

const config = {api: import.meta.env.VITE_ECOMMERCE_API_URL || '', tenant: import.meta.env.VITE_TENANT_ID || '', company: import.meta.env.VITE_COMPANY_ID || ''}
let stores = []
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))

async function request(path, options = {}) {
  const token = await window.mastererpAuth?.getAccessToken?.()
  if (!token) throw new Error('Sesión no disponible.')
  const response = await fetch(config.api + path, {...options, headers: {Authorization: `Bearer ${token}`, 'X-Tenant-Id': config.tenant, 'Content-Type': 'application/json', ...(options.headers || {})}})
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message || `Error ${response.status}`)
  return body
}

async function load() {
  try { stores = (await request(`/v1/companies/${config.company}/stores`)).items; render() }
  catch (error) { render(error.message) }
}

async function save(event) {
  event.preventDefault()
  const form = new FormData(event.currentTarget)
  const id = form.get('id')
  const changes = {status: form.get('status'), branding: {primaryColor: form.get('color')}, modules: String(form.get('modules')).split(',').map(x => x.trim()).filter(Boolean)}
  const payload = id ? {version: Number(form.get('version')), changes} : {node_id: form.get('node'), domain: form.get('domain'), name: form.get('name'), changes}
  try { await request(`/v1/companies/${config.company}/stores${id ? `/${id}` : ''}`, {method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload)}); await load() }
  catch (error) { render(error.message) }
}

function edit(id) {
  const store = stores.find(item => item.id === id)
  const form = document.querySelector('form')
  for (const [name, value] of Object.entries({id: store.id, version: store.version, node: store.node_id, domain: store.domain, name: store.name, status: store.status, color: store.branding?.primaryColor || '#3157d5', modules: (store.modules || []).join(',')})) form.elements[name].value = value
}

function render(error = '') {
  document.querySelector('#app').innerHTML = `<header><div><small>DIGITAL SALES · E-COMMERCE</small><h1>Tiendas</h1></div><button id="refresh">Actualizar</button></header>${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}<section>${stores.map(store => `<button class="store" data-id="${store.id}"><span><strong>${escapeHtml(store.name)}</strong><small>${escapeHtml(store.domain)}</small></span><b>${escapeHtml(store.status)}</b></button>`).join('') || '<p>No hay tiendas configuradas.</p>'}</section><form><h2>Configurar tienda</h2><input type="hidden" name="id"><input type="hidden" name="version"><div class="grid"><label>Nodo<input name="node" required></label><label>Dominio<input name="domain" required></label><label>Nombre<input name="name" required></label><label>Estado<select name="status"><option>DRAFT</option><option>ACTIVE</option><option>PAUSED</option></select></label><label>Color<input name="color" type="color" value="#3157d5"></label><label>Módulos opcionales<input name="modules" placeholder="transport.drivers"></label></div><button class="primary">Guardar</button></form>`
  document.querySelector('#refresh').onclick = load
  document.querySelector('form').onsubmit = save
  document.querySelectorAll('[data-id]').forEach(button => button.onclick = () => edit(button.dataset.id))
}

render()
if (config.api && config.tenant && config.company && window.mastererpAuth?.getAccessToken) load()
