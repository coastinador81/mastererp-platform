import React, {useEffect, useState} from 'react';
import CatalogImageGallery from './CatalogImageGallery.jsx';
import CatalogAttributePicker from './CatalogAttributePicker.jsx';
import CatalogVariantRows, {duplicateVariantSkus, VariantGeneration} from './CatalogVariantRows.jsx';
import CatalogSupplierPicker from './CatalogSupplierPicker.jsx';
import {CatalogStatusBadge} from './CatalogListPage.jsx';
import CatalogProductPriceSection from './CatalogProductPriceSection.jsx';
import {catalogHref, packagingRequiresConversionFactor, productIdentificationFromRecord, productMeasureFromRecord, productPackagingUnits, productPricingFromRecord, productSaleUnits, productStorageTypes, statusLabels} from './catalogModel.mjs';
import {mergeProductPricingDemo} from './productPricingFinance.mjs';

export function CatalogFormSection({title, description, children}) {
  return <section className="cat-form-section"><h2>{title}</h2>{description && <p>{description}</p>}<div className="cat-fields">{children}</div></section>;
}
const dateText = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('es') : 'No disponible';
const slugFromName = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const variantPresets = [
  {code: 'color', name: 'Color', options: ['Negro', 'Blanco', 'Azul', 'Rojo']},
  {code: 'talla', name: 'Talla', options: ['XS', 'S', 'M', 'L', 'XL']},
  {code: 'peso_presentacion', name: 'Peso / presentación', options: ['250 g', '500 g', '1 kg', '2 kg']},
  {code: 'volumen_presentacion', name: 'Volumen', options: ['250 ml', '500 ml', '1 L', '2 L']},
  {code: 'sabor', name: 'Sabor', options: ['Original', 'Vainilla', 'Chocolate', 'Fresa']},
  {code: 'tamano', name: 'Tamaño', options: ['Pequeño', 'Mediano', 'Grande']},
];
export function CatalogPublishPanel({record, status, setStatus, disabled, canSetStatus}) {
  return <div className="cat-editor-side"><section className="cat-surface"><h2 className="cat-panel-title">Publicación</h2><div className="cat-panel-body"><label className="cat-switch-row"><span>Visible / activo<small>Estado del registro en el catálogo</small></span><input type="checkbox" role="switch" checked={status === 'ACTIVE'} disabled={disabled || !canSetStatus} onChange={e => setStatus(e.target.checked ? 'ACTIVE' : 'INACTIVE')}/></label>{!canSetStatus && <p>Los nuevos registros se crean activos. Puedes cambiar su estado después de guardarlos.</p>}<dl><dt>Estado</dt><dd><CatalogStatusBadge status={status}/></dd><dt>Creado</dt><dd>{dateText(record?.created_at)}</dd><dt>Actualizado</dt><dd>{dateText(record?.updated_at)}</dd></dl></div></section></div>;
}

export default function CatalogEditorPage({definition, route, record, writable, busy, save, notify, categoryOptions = [], brandOptions = [], supplierOptions = [], attributeOptions = [], uploadProductImage, createVariantAttribute, canCreateAttributes = false, financePricingConfig = {sale_tax_rate: '', cost_tax_rate: '', usd_exchange_rate: '', eur_exchange_rate: ''}}) {
  const [draft, setDraft] = useState(() => ({
    name: '', status: 'ACTIVE', description: '', type: 'TEXT', required: false, options: [], category_slugs: [], sort_order: 0, contact: {}, terms: {},
    ...record,
    ...productIdentificationFromRecord(record),
    ...productMeasureFromRecord(record),
    ...(route === 'products' ? mergeProductPricingDemo(productPricingFromRecord(record)) : productPricingFromRecord(record)),
  }));
  const [tab, setTab] = useState('general'), [dirty, setDirty] = useState(false);
  const [variantUploading, setVariantUploading] = useState(false);
  const disabled = !writable || busy || variantUploading;
  const canSetStatus = Boolean(record) || route === 'products';
  const update = (key, value) => {
    setDraft(current => ({
      ...current,
      [key]: value,
      ...(key === 'name' && route === 'brands' && !record ? {slug: slugFromName(value)} : {}),
      ...(key === 'packaging_unit' && !packagingRequiresConversionFactor(value) ? {packaging_factor: ''} : {}),
    }));
    setDirty(true);
  };
  const applyPricingFields = patch => {
    setDraft(current => ({...current, ...patch}));
    setDirty(true);
  };
  const updateProductIdentification = (key, value) => {
    setDraft(current => {
      const next = {...current, [key]: value};
      if (key === 'supplier_identification') next.suppliers = (current.suppliers || []).map((item, index, suppliers) => {
        const preferredIndex = suppliers.findIndex(entry => entry.preferred);
        const targetIndex = preferredIndex >= 0 ? preferredIndex : 0;
        return index === targetIndex ? {...item, supplier_code: value} : item;
      });
      return next;
    });
    setDirty(true);
  };
  const toggleProductSupplier = (supplier, checked) => {
    if (checked) {
      if ((draft.suppliers || []).some(item => item.id === supplier.id)) return;
      const preferred = !(draft.suppliers || []).length;
      update('suppliers', [...(draft.suppliers || []), {id: supplier.id, supplier_code: '', cost: null, lead_days: null, preferred}]);
      return;
    }
    update('suppliers', (draft.suppliers || []).filter(item => item.id !== supplier.id));
  };
  const catalogAttributes = {attribute_codes: [], variants: [], ...draft.attributes?._catalog};
  const savedVariantKeys = new Set((record?.attributes?._catalog?.variants || []).map(item => item.key));
  const gallery = draft.attributes?._media?.images || [];
  const images = draft.image_url && !gallery.some(image => image.url === draft.image_url)
    ? [...gallery, {name: 'Portada del producto', url: draft.image_url}]
    : gallery;
  const updateCatalogAttributes = changes => update('attributes', {...(draft.attributes || {}), _catalog: {...catalogAttributes, ...changes}});
  const toggleAttribute = code => updateCatalogAttributes({attribute_codes: catalogAttributes.attribute_codes.includes(code) ? catalogAttributes.attribute_codes.filter(item => item !== code) : [...catalogAttributes.attribute_codes, code]});
  const variantAttributeOptions = attributeOptions.filter(attribute => ['SELECT', 'MULTISELECT'].includes(attribute.type));
  const toggleVariantAttribute = (code, checked) => {
    const isSelected = catalogAttributes.attribute_codes.includes(code);
    if (checked === isSelected) return;
    toggleAttribute(code);
  };
  const changeVariant = (key, changes) => updateCatalogAttributes({variants: catalogAttributes.variants.map(item => item.key === key ? {...item, ...changes} : item)});
  const addVariant = (base = false) => {
    const key = base ? 'base' : `custom:${crypto.randomUUID()}`;
    const row = {key, values: {}, label: base ? 'Presentación base' : 'Nueva combinación', sku: base ? draft.sku || '' : '', price_delta: 0, active: true};
    updateCatalogAttributes({variants: [...catalogAttributes.variants, row]});
  };
  const removeVariant = key => updateCatalogAttributes({variants: catalogAttributes.variants.filter(item => item.key !== key)});
  async function uploadVariantImage(key, file) {
    if (disabled || !record?.id) return;
    if (images.length >= 8 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      notify('La galería admite hasta 8 imágenes JPG, PNG o WebP de máximo 5 MB.');
      return;
    }
    setVariantUploading(true);
    try {
      const image = await uploadProductImage(record.id, file);
      setDraft(current => {
        const attributes = current.attributes || {};
        const catalog = attributes._catalog;
        return {...current, attributes: {...attributes,
          _media: {...attributes._media, images: [...images, image]},
          _catalog: {...catalog, variants: catalog.variants.map(row => row.key === key
            ? {...row, image_url: image.url, image_kind: 'specific'} : row)},
        }};
      });
      setDirty(true);
    } catch {
      notify('No se pudo cargar la imagen de la variante.');
    } finally {
      setVariantUploading(false);
    }
  }
  const prepareVariantAttribute = async preset => {const attribute = await createVariantAttribute(preset); if (attribute && !catalogAttributes.attribute_codes.includes(attribute.code)) toggleAttribute(attribute.code);};
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
  const field = (key, label, props = {}, onChange = update) => <label key={key} className={props.wide ? 'cat-full' : undefined}>{label}<input name={key} value={draft[key] ?? ''} disabled={disabled} onChange={e => onChange(key, props.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'wide'))}/></label>;
  const productIdentificationField = (key, label, props = {}) => field(key, label, props, updateProductIdentification);
  const selectField = (key, label, options, onChange = update, className) => (
    <label key={key} className={className}>
      {label}
      <select name={key} value={draft[key] ?? ''} disabled={disabled} onChange={event => onChange(key, event.target.value)}>
        <option value="">Seleccionar…</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
  const tabs = [['general', 'Información general'], ...(route === 'products' ? [['organization', 'Clasificación'], ['variants', 'Variantes'], ['price', 'Precio'], ['images', 'Imágenes']] : [])];
  async function submit(event) {
    event.preventDefault();
    if (!draft.name.trim() || (route === 'products' && !(Number(draft.price) > 0))) {notify('Completa el nombre y un precio mayor que cero.'); setTab(!draft.name.trim() ? 'general' : 'price'); return;}
    if (route === 'attributes' && ['SELECT', 'MULTISELECT'].includes(draft.type) !== draft.options.some(value => value.trim())) {notify('Los tipos de selección requieren valores; los demás tipos no admiten opciones.'); setTab('general'); return;}
    if (disabled) return;
    if (route === 'products' && duplicateVariantSkus(catalogAttributes.variants).size) {
      notify('Corrige los SKU duplicados de las variantes.');
      setTab('variants');
      return;
    }
    if (await save(draft)) setDirty(false);
  }
  return <form className="cat-editor" onSubmit={submit} onInvalid={event => {event.preventDefault(); const control = event.target; const panel = control.closest('[role=tabpanel]'); if (panel) setTab(panel.id.replace('cat-panel-', '')); requestAnimationFrame(() => control.focus()); notify('Revisa los campos obligatorios y sus formatos.');}}><a className="cat-back" href={catalogHref(route)} onClick={back}>← Volver a {definition.title.toLowerCase()}</a>
    <div className="cat-heading"><div><nav aria-label="Ruta de navegación">E-commerce / Catálogo / {definition.title}</nav><h1>{record ? record.name : `Nuevo ${definition.singular}`}</h1><p>{record ? 'Edita la información y configuración de este registro.' : definition.description}</p></div><div className="cat-actions"><a href={catalogHref(route)} onClick={back}>Cancelar</a>{writable && <button className="cat-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>}</div></div>
    <div className="cat-editor-layout"><div className="cat-surface"><div className="cat-tabs" role="tablist" aria-label="Secciones del registro">{tabs.map(([key, label], index) => <button type="button" role="tab" id={`cat-tab-${key}`} aria-controls={`cat-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} key={key} onClick={() => setTab(key)} onKeyDown={e => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; setTab(tabs[next][0]); document.getElementById(`cat-tab-${tabs[next][0]}`)?.focus();}}}>{label}</button>)}</div>
      {tabs.map(([key]) => <div key={key} role="tabpanel" id={`cat-panel-${key}`} aria-labelledby={`cat-tab-${key}`} hidden={tab !== key}>
        {key === 'general' && <CatalogFormSection title="Información general" description="Identidad y datos principales del registro.">
          {route === 'products' && (
            <label className="cat-status-compact">Estado<select value={draft.status} disabled={disabled || !canSetStatus} onChange={e => update('status', e.target.value)}>{definition.statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
          )}
          {field('name', 'Nombre *', {required: true, maxLength: route === 'attributes' ? 160 : 200, wide: true})}
          {route === 'products' && definition.fields.includes('description') && (
            <label className="cat-full">Descripción<textarea maxLength={2000} value={draft.description || ''} disabled={disabled} onChange={e => update('description', e.target.value)}/></label>
          )}
          {route !== 'products' && field(definition.reference, 'Referencia', {readOnly: Boolean(record) || route === 'brands', disabled: route === 'brands', placeholder: route === 'brands' ? 'Generada automáticamente desde el nombre' : undefined, required: route !== 'products', pattern: definition.reference === 'slug' ? '[a-z0-9]+(?:-[a-z0-9]+)*' : route === 'attributes' ? '[a-z][a-z0-9_]{0,79}' : undefined})}
          {route === 'products' && <>
            {productIdentificationField('sku', 'SKU', {maxLength: 80, placeholder: 'Código comercial del producto'})}
            {productIdentificationField('barcode', 'Código de barras', {maxLength: 80, placeholder: 'EAN, UPC u otro GTIN'})}
            {productIdentificationField('qr', 'QR', {maxLength: 512, placeholder: 'Contenido o URL codificada en el QR'})}
            {productIdentificationField('supplier_identification', 'Identificación de proveedor', {maxLength: 120, placeholder: 'Referencia del producto en el proveedor'})}
            {field('weight', 'Peso', {type: 'number', min: 0.000001, step: 0.000001, placeholder: 'Peso por unidad de venta'})}
            {selectField('sale_unit', 'Unidad de venta', productSaleUnits)}
            <div className={`cat-full cat-packaging-row${packagingRequiresConversionFactor(draft.packaging_unit) ? '' : ' cat-packaging-row--single'}`}>
              {selectField('packaging_unit', 'Unidad de embalaje', productPackagingUnits)}
              {packagingRequiresConversionFactor(draft.packaging_unit) && field('packaging_factor', 'Factor de conversión', {
                type: 'number',
                min: 1,
                step: 1,
                placeholder: `Unidades por ${productPackagingUnits.find(item => item.value === draft.packaging_unit)?.label.toLowerCase() || 'embalaje'}`,
              })}
            </div>
            {selectField('storage_type', 'Tipo de almacenamiento', productStorageTypes, update, 'cat-full')}
          </>}
          {route !== 'products' && (
            <label>Estado<select value={draft.status} disabled={disabled || !canSetStatus} onChange={e => update('status', e.target.value)}>{definition.statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
          )}
          {route !== 'products' && definition.fields.includes('description') && <label className="cat-full">Descripción<textarea maxLength={2000} value={draft.description || ''} disabled={disabled} onChange={e => update('description', e.target.value)}/></label>}
          {route === 'brands' && <>{field('website_url', 'Sitio web', {type: 'url'})}{field('logo_url', 'URL del logotipo', {type: 'url'})}</>}
          {route === 'suppliers' && <>{['email', 'phone'].map(name => <label key={name}>{name === 'email' ? 'Correo de contacto' : 'Teléfono'}<input type={name === 'email' ? 'email' : 'tel'} disabled={disabled} value={draft.contact?.[name] || ''} onChange={e => update('contact', {...draft.contact, [name]: e.target.value})}/></label>)}<label>Plazo de pago (días)<input type="number" min="0" disabled={disabled} value={draft.terms?.payment_days ?? ''} onChange={e => update('terms', {...draft.terms, payment_days: Number(e.target.value)})}/></label></>}
          {route === 'attributes' && <><label>Tipo<select value={draft.type} disabled={disabled || Boolean(record)} onChange={e => update('type', e.target.value)}>{['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTISELECT'].map(type => <option key={type}>{type}</option>)}</select></label>{field('unit', 'Unidad')}<label className="cat-switch-row">Obligatorio<input type="checkbox" role="switch" checked={Boolean(draft.required)} disabled={disabled} onChange={e => update('required', e.target.checked)}/></label><label className="cat-full">Valores (uno por línea)<textarea value={(draft.options || []).join('\n')} disabled={disabled} onChange={e => update('options', e.target.value.split('\n'))}/></label></>}
          {route === 'attributes' && field('sort_order', 'Orden de visualización', {type: 'number', min: 0})}
          {route === 'categories' && <><label>Categoría padre<select value={draft.parent_slug || ''} disabled={disabled} onChange={e => update('parent_slug', e.target.value)}><option value="">Sin categoría padre</option>{categoryOptions.filter(item => item.slug !== record?.slug).map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>{field('sort_order', 'Orden de visualización', {type: 'number', min: 0})}{field('image_url', 'URL de imagen', {type: 'url', wide: true})}</>}
        </CatalogFormSection>}
        {key === 'organization' && <CatalogFormSection title="Clasificación" description="Ubica el producto en la categoría principal que verá el cliente.">
          <label>Categoría principal<select value={draft.category_ref || ''} disabled={disabled} onChange={e => update('category_ref', e.target.value)}><option value="">Sin categoría</option>{categoryOptions.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
          <label>Marca<select value={draft.brand_ref || ''} disabled={disabled} onChange={e => update('brand_ref', e.target.value)}><option value="">Sin marca</option>{brandOptions.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
          <CatalogSupplierPicker
            supplierOptions={supplierOptions}
            relations={draft.suppliers || []}
            disabled={disabled}
            onToggle={toggleProductSupplier}
          />
        </CatalogFormSection>}
        {key === 'variants' && <CatalogFormSection title="Variantes" description="Crea las presentaciones vendibles del producto a partir de atributos como color, talla, peso o sabor.">
          <section className="cat-full cat-variant-builder"><div className="cat-variant-builder-heading"><div><span className="cat-step">1</span><div><h3>Elige los atributos</h3><p>Selecciona uno o más atributos para combinar sus valores.</p></div></div><span>{catalogAttributes.attribute_codes.length} {catalogAttributes.attribute_codes.length === 1 ? 'atributo seleccionado' : 'atributos seleccionados'}</span></div><CatalogAttributePicker attributeOptions={variantAttributeOptions} selectedCodes={catalogAttributes.attribute_codes} disabled={disabled} onToggle={toggleVariantAttribute}/><div className="cat-builder-actions"><details className="cat-preset-panel" open={!attributeOptions.length}><summary>Añadir atributos al catálogo</summary><p>Usa una plantilla y luego ajusta sus valores desde Atributos.</p><div className="cat-attribute-presets">{canCreateAttributes && variantPresets.map(preset => {const exists = attributeOptions.some(attribute => attribute.code === preset.code); return <button type="button" key={preset.code} disabled={busy || exists} onClick={() => prepareVariantAttribute(preset)}>{exists ? `${preset.name} disponible` : `Usar ${preset.name}`}</button>;})}<a className="cat-detail-link" href={catalogHref('attributes', null, 'new')}>Crear personalizado</a></div></details></div><VariantGeneration
            key={JSON.stringify([catalogAttributes.attribute_codes, catalogAttributes.variants.map(row => row.key)])}
            codes={catalogAttributes.attribute_codes} definitions={variantAttributeOptions} variants={catalogAttributes.variants}
            savedKeys={savedVariantKeys} onApply={variants => updateCatalogAttributes({variants})}
            disabled={disabled} notify={notify}/></section>
          <div className="cat-full cat-variant-list-heading">
            <h3>Combinaciones</h3>
            <div className="cat-variant-buttons">
              <button type="button" disabled={disabled || catalogAttributes.variants.length > 0} onClick={() => addVariant(true)}>Crear variante base</button>
              <button type="button" disabled={disabled || catalogAttributes.variants.length >= 200} onClick={() => addVariant()}>Añadir manualmente</button>
            </div>
          </div>
          {variantUploading && <p className="cat-full" role="status">Cargando imagen…</p>}
          <CatalogVariantRows variants={catalogAttributes.variants} savedKeys={savedVariantKeys} images={images}
            price={draft.price} currency={draft.pricing_currency || 'USD'} disabled={disabled} notify={notify}
            onChange={changeVariant} onRemove={removeVariant} upload={record?.id && uploadProductImage ? uploadVariantImage : undefined}/>
          <aside className="cat-full cat-info-block"><span aria-hidden="true">i</span><p>Para editar o agregar variantes, utiliza esta pestaña antes de guardar el producto.</p></aside>
        </CatalogFormSection>}
        {key === 'price' && <CatalogProductPriceSection draft={draft} disabled={disabled} update={update} applyPricingFields={applyPricingFields} financePricingConfig={financePricingConfig}/>}
        {key === 'images' && <CatalogFormSection title="Imágenes" description="Gestiona la portada y las fotografías del producto desde una sola galería."><CatalogImageGallery saved={Boolean(record?.id)} images={draft.attributes?._media?.images || []} coverUrl={draft.image_url} upload={file => uploadProductImage(record.id, file)} onChange={(images, imageUrl) => {setDraft(current => ({...current, image_url: imageUrl, attributes: {...(current.attributes || {}), _media: {images}}})); setDirty(true);}} disabled={disabled}/></CatalogFormSection>}
      </div>)}
      <div className="cat-editor-footer"><a href={catalogHref(route)} onClick={back}>Cancelar</a>{writable && <button className="cat-primary" disabled={busy}>Guardar {definition.singular}</button>}</div>
    </div><CatalogPublishPanel record={record} status={draft.status} setStatus={value => update('status', value)} disabled={disabled} canSetStatus={canSetStatus}/></div>
  </form>;
}
