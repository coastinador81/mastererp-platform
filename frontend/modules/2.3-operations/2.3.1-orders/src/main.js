import './style.css'

const config = {
  api: import.meta.env.VITE_ORDERS_API_URL || '',
  tenant: import.meta.env.VITE_TENANT_ID || '',
  company: import.meta.env.VITE_COMPANY_ID || ''
}
const state = {items: [], status: '', selected: null, loading: false, error: ''}
const labels = {PENDING:'Pendiente',CONFIRMED:'Confirmado',PREPARING:'En preparación',READY:'Listo',OUT_FOR_DELIVERY:'En reparto',DELIVERED:'Entregado',CANCELLED:'Cancelado'}
const next = {PENDING:['CONFIRMED','CANCELLED'],CONFIRMED:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['OUT_FOR_DELIVERY'],OUT_FOR_DELIVERY:['DELIVERED']}

async function request(path, options={}) {
  const token = await window.mastererpAuth?.getAccessToken?.()
  if (!token) throw new Error('Sesión autenticada no disponible en el app-shell.')
  const response = await fetch(`${config.api}${path}`, { ...options, headers:{Authorization:`Bearer ${token}`,'X-Tenant-Id':config.tenant,'Content-Type':'application/json',...(options.headers||{})} })
  const data = await response.json().catch(()=>({}))
  if (!response.ok) throw new Error(data.error?.message || `Error ${response.status}`)
  return data
}
async function load() {
  state.loading=true; state.error=''; render()
  try { const query=state.status?`?status=${state.status}`:''; state.items=(await request(`/v1/companies/${config.company}/orders${query}`)).items }
  catch(error){state.error=error.message} finally {state.loading=false;render()}
}
async function transition(status) {
  const reason=window.prompt(`Motivo para cambiar a ${labels[status]}`,'MANUAL_OPERATION'); if(!reason)return
  try { state.selected=await request(`/v1/companies/${config.company}/orders/${state.selected.id}/transitions`,{method:'POST',body:JSON.stringify({version:state.selected.version,status,reason})}); await load() }
  catch(error){state.error=error.message;render()}
}
function money(value,currency){return new Intl.NumberFormat('es-VE',{style:'currency',currency}).format(Number(value))}
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
function render() {
  document.querySelector('#app').innerHTML=`<header><div><small>OPERACIONES · 2.3.1</small><h1>Pedidos</h1><p>Control manual de pedidos y su ciclo operativo.</p></div><button id="refresh">Actualizar</button></header>
  <section class="toolbar"><label>Estado<select id="status"><option value="">Todos</option>${Object.entries(labels).map(([v,l])=>`<option value="${v}" ${state.status===v?'selected':''}>${l}</option>`).join('')}</select></label><span>${state.items.length} pedidos</span></section>
  ${state.error?`<p class="error" role="alert">${escapeHtml(state.error)}</p>`:''}
  <section class="layout"><div class="list">${state.loading?'<p>Cargando…</p>':state.items.map(order=>`<button class="card ${state.selected?.id===order.id?'active':''}" data-id="${order.id}"><span><strong>${escapeHtml(order.number)}</strong><small>${escapeHtml(order.customer_snapshot?.name||order.customer_id)}</small></span><span><b class="badge ${order.status}">${labels[order.status]||order.status}</b><strong>${money(order.total,order.currency)}</strong></span></button>`).join('')||'<p class="empty">No hay pedidos para este filtro.</p>'}</div>
  <aside>${state.selected?detail(state.selected):'<p class="empty">Selecciona un pedido para ver el detalle.</p>'}</aside></section>`
  document.querySelector('#refresh').onclick=load
  document.querySelector('#status').onchange=event=>{state.status=event.target.value;load()}
  document.querySelectorAll('[data-id]').forEach(button=>button.onclick=()=>{state.selected=state.items.find(item=>item.id===button.dataset.id);render()})
  document.querySelectorAll('[data-transition]').forEach(button=>button.onclick=()=>transition(button.dataset.transition))
}
function detail(order){return `<div class="detail-head"><div><small>${escapeHtml(order.number)}</small><h2>${labels[order.status]||order.status}</h2></div><strong>${money(order.total,order.currency)}</strong></div>
<dl><div><dt>Cliente</dt><dd>${escapeHtml(order.customer_snapshot?.name||order.customer_id)}</dd></div><div><dt>Entrega</dt><dd>${escapeHtml(order.delivery_snapshot?.address||order.delivery_window_ref)}</dd></div><div><dt>Pago</dt><dd>${escapeHtml(order.payment_snapshot?.method)} · ${escapeHtml(order.payment_snapshot?.status)}</dd></div></dl>
<h3>Productos</h3><ul>${order.items.map(item=>`<li><span>${escapeHtml(item.product_name)} × ${escapeHtml(item.quantity)}</span><strong>${money(item.subtotal,order.currency)}</strong></li>`).join('')}</ul>
<div class="actions">${(next[order.status]||[]).map(status=>`<button data-transition="${status}" class="${status==='CANCELLED'?'danger':''}">${labels[status]}</button>`).join('')||'<span>Ciclo finalizado</span>'}</div>`}
render(); if(config.api&&config.tenant&&config.company&&window.mastererpAuth?.getAccessToken)load(); else state.error='Configura API, tenant y empresa, e integra el proveedor de sesión del app-shell.',render()
