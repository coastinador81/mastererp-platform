import React, {useEffect, useState} from 'react';
import CatalogImageGallery from './CatalogImageGallery.jsx';
import {CatalogStatusBadge} from './CatalogListPage.jsx';
import {catalogHref, statusLabels} from './catalogModel.mjs';
import {MODULES} from '../../../../shared/module-launcher/module-launcher.mjs';

const inventoryUrl = MODULES.find(module => module.id === 'inventory')?.href;

export function CatalogFormSection({title, description, children}) {
  return <section className="cat-form-section"><h2>{title}</h2>{description && <p>{description}</p>}<div className="cat-fields">{children}</div></section>;
}
const dateText = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('es') : 'No disponible';
export function CatalogPublishPanel({record, status, setStatus, disabled, canSetStatus}) {
  return <div className="cat-editor-side"><section className="cat-surface"><h2 className="cat-panel-title">Publicación</h2><div className="cat-panel-body"><label className="cat-switch-row"><span>Visible / activo<small>Estado del registro en el catálogo</small></span><input type="checkbox" role="switch" checked={status === 'ACTIVE'} disabled={disabled || !canSetStatus} onChange={e => setStatus(e.target.checked ? 'ACTIVE' : 'INACTIVE')}/></label>{!canSetStatus && <p>Los nuevos registros se crean activos. Puedes cambiar su estado después de guardarlos.</p>}<dl><dt>Estado</dt><dd><CatalogStatusBadge status={status}/></dd><dt>Creado</dt><dd>{dateText(record?.created_at)}</dd><dt>Actualizado</dt><dd>{dateText(record?.updated_at)}</dd></dl></div></section></div>;
}

export default function CatalogEditorPage({definition, route, record, writable, busy, save, notify, categoryOptions = [], uploadProductImage}) {
  const [draft, setDraft] = useState(() => ({name: '', status: 'ACTIVE', description: '', type: 'TEXT', required: false, options: [], category_slugs: [], sort_order: 0, contact: {}, terms: {}, ...record}));
  const [tab, setTab] = useState('general'), [dirty, setDirty] = useState(false);
  const disabled = !writable || busy;
  const canSetStatus = Boolean(record) || route === 'products';
  const update = (key, value) => {setDraft(current => ({...current, [key]: value})); setDirty(true);};
  useEffect(() => {const prevent = event => {if (dirty) {event.preventDefault(); event.returnValue = '';}}; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);}, [dirty]);
  useEffect(() => {
    const confirmNavigation = event => {
      const target = event.target.closest('a[href],.workspace-card-options button');
      if (!dirty || !target || target.closest('.cat-editor') || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!window.confirm('¿Descartar los cambios sin guardar?')) {event.preventDefault(); event.stopPropagation();}
    };
    document.addEventListener('click', confirmNavigation, true);
    return () => document.removeEventListener('click', confirmNavigation, true);
  }, [dirty]);
  const back = e => {if (dirty && !window.confirm('¿Descartar los cambios sin guardar?')) e.preventDefault();};
  const field = (key, label, props = {}) => <label key={key} className={props.wide ? 'cat-full' : undefined}>{label}<input name={key} value={draft[key] ?? ''} disabled={disabled} onChange={e => update(key, props.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'wide'))}/></label>;
  const tabs = [['general', 'Información general'], ...(route === 'products' ? [['organization', 'Clasificación'], ['price', 'Precio'], ['images', 'Imágenes']] : [])];
  async function submit(event) {
    event.preventDefault();
    if (!draft.name.trim() || (route === 'products' && !(Number(draft.price) > 0))) {notify('Completa el nombre y un precio mayor que cero.'); setTab(!draft.name.trim() ? 'general' : 'price'); return;}
    if (route === 'attributes' && ['SELECT', 'MULTISELECT'].includes(draft.type) !== draft.options.some(value => value.trim())) {notify('Los tipos de selección requieren valores; los demás tipos no admiten opciones.'); setTab('general'); return;}
    if (await save(draft)) setDirty(false);
  }
  return <form className="cat-editor" onSubmit={submit} onInvalid={event => {event.preventDefault(); const control = event.target; const panel = control.closest('[role=tabpanel]'); if (panel) setTab(panel.id.replace('cat-panel-', '')); requestAnimationFrame(() => control.focus()); notify('Revisa los campos obligatorios y sus formatos.');}}><a className="cat-back" href={catalogHref(route)} onClick={back}>← Volver a {definition.title.toLowerCase()}</a>
    <div className="cat-heading"><div><nav aria-label="Ruta de navegación">E-commerce / Catálogo / {definition.title}</nav><h1>{record ? record.name : `Nuevo ${definition.singular}`}</h1><p>{record ? 'Edita la información y configuración de este registro.' : definition.description}</p></div><div className="cat-actions"><a href={catalogHref(route)} onClick={back}>Cancelar</a>{writable && <button className="cat-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>}</div></div>
    <div className="cat-editor-layout"><div className="cat-surface"><div className="cat-tabs" role="tablist" aria-label="Secciones del registro">{tabs.map(([key, label], index) => <button type="button" role="tab" id={`cat-tab-${key}`} aria-controls={`cat-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} key={key} onClick={() => setTab(key)} onKeyDown={e => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; setTab(tabs[next][0]); document.getElementById(`cat-tab-${tabs[next][0]}`)?.focus();}}}>{label}</button>)}</div>
      {tabs.map(([key]) => <div key={key} role="tabpanel" id={`cat-panel-${key}`} aria-labelledby={`cat-tab-${key}`} hidden={tab !== key}>
        {key === 'general' && <CatalogFormSection title="Información general" description="Identidad y datos principales del registro.">
          {field('name', 'Nombre *', {required: true, maxLength: route === 'attributes' ? 160 : 200, wide: true})}
          {field(definition.reference, 'Referencia', {readOnly: Boolean(record) || route === 'products', placeholder: route === 'products' ? 'Generada automáticamente' : undefined, required: route !== 'products', pattern: definition.reference === 'slug' ? '[a-z0-9]+(?:-[a-z0-9]+)*' : route === 'attributes' ? '[a-z][a-z0-9_]{0,79}' : undefined})}
          <label>Estado<select value={draft.status} disabled={disabled || !canSetStatus} onChange={e => update('status', e.target.value)}>{definition.statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
          {definition.fields.includes('description') && <label className="cat-full">Descripción<textarea maxLength={2000} value={draft.description || ''} disabled={disabled} onChange={e => update('description', e.target.value)}/></label>}
          {route === 'brands' && <>{field('website_url', 'Sitio web', {type: 'url'})}{field('logo_url', 'URL del logotipo', {type: 'url'})}</>}
          {route === 'suppliers' && <>{['email', 'phone'].map(name => <label key={name}>{name === 'email' ? 'Correo de contacto' : 'Teléfono'}<input type={name === 'email' ? 'email' : 'tel'} disabled={disabled} value={draft.contact?.[name] || ''} onChange={e => update('contact', {...draft.contact, [name]: e.target.value})}/></label>)}<label>Plazo de pago (días)<input type="number" min="0" disabled={disabled} value={draft.terms?.payment_days ?? ''} onChange={e => update('terms', {...draft.terms, payment_days: Number(e.target.value)})}/></label></>}
          {route === 'attributes' && <><label>Tipo<select value={draft.type} disabled={disabled || Boolean(record)} onChange={e => update('type', e.target.value)}>{['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTISELECT'].map(type => <option key={type}>{type}</option>)}</select></label>{field('unit', 'Unidad')}<label className="cat-switch-row">Obligatorio<input type="checkbox" role="switch" checked={Boolean(draft.required)} disabled={disabled} onChange={e => update('required', e.target.checked)}/></label><label className="cat-full">Valores (uno por línea)<textarea value={(draft.options || []).join('\n')} disabled={disabled} onChange={e => update('options', e.target.value.split('\n'))}/></label></>}
          {route === 'attributes' && field('sort_order', 'Orden de visualización', {type: 'number', min: 0})}
          {route === 'categories' && <><label>Categoría padre<select value={draft.parent_slug || ''} disabled={disabled} onChange={e => update('parent_slug', e.target.value)}><option value="">Sin categoría padre</option>{categoryOptions.filter(item => item.slug !== record?.slug).map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>{field('sort_order', 'Orden de visualización', {type: 'number', min: 0})}{field('image_url', 'URL de imagen', {type: 'url', wide: true})}</>}
        </CatalogFormSection>}
        {key === 'organization' && <CatalogFormSection title="Clasificación" description="Ubica el producto en la categoría principal que verá el cliente.">
          <label>Categoría principal<select value={draft.category_ref || ''} disabled={disabled} onChange={e => update('category_ref', e.target.value)}><option value="">Sin categoría</option>{categoryOptions.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
        </CatalogFormSection>}
        {key === 'price' && <CatalogFormSection title="Precio" description="Gestiona el precio de venta del producto en el catálogo.">{field('price', 'Precio de venta *', {type: 'number', min: 0.000001, step: 0.000001})}<div className="cat-full"><h2>Inventario</h2><p>Las existencias, los movimientos y las alertas se gestionan en el módulo de Inventario, con sus permisos correspondientes.</p>{inventoryUrl && <a className="cat-detail-link" href={inventoryUrl} target="_blank" rel="noopener noreferrer">Abrir Inventario (nueva pestaña)</a>}</div></CatalogFormSection>}
        {key === 'images' && <CatalogFormSection title="Imágenes" description="Gestiona la portada y las fotografías del producto desde una sola galería."><CatalogImageGallery saved={Boolean(record?.id)} images={draft.attributes?._media?.images || []} coverUrl={draft.image_url} upload={file => uploadProductImage(record.id, file)} onChange={(images, imageUrl) => {setDraft(current => ({...current, image_url: imageUrl, attributes: {...(current.attributes || {}), _media: {images}}})); setDirty(true);}} disabled={disabled}/></CatalogFormSection>}
      </div>)}
      <div className="cat-editor-footer"><a href={catalogHref(route)} onClick={back}>Cancelar</a>{writable && <button className="cat-primary" disabled={busy}>Guardar {definition.singular}</button>}</div>
    </div><CatalogPublishPanel record={record} status={draft.status} setStatus={value => update('status', value)} disabled={disabled} canSetStatus={canSetStatus}/></div>
  </form>;
}
