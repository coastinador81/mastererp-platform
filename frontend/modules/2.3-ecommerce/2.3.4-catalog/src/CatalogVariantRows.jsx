import React, {useState} from 'react';
import {generateProductVariants, productPackagingUnits, productSaleUnits} from './catalogModel.mjs';

const labelOf = variant => variant.label ?? Object.values(variant.values || {}).join(' / ');
const skuOf = variant => String(variant.sku || '').trim().toLowerCase();
export const duplicateVariantSkus = variants => {
  const seen = new Set(), duplicates = new Set();
  for (const variant of variants) {
    const sku = skuOf(variant);
    if (!sku) continue;
    if (seen.has(sku)) duplicates.add(sku);
    seen.add(sku);
  }
  return duplicates;
};

export function VariantGeneration({codes, definitions, variants, savedKeys, onApply, disabled, notify}) {
  const [options, setOptions] = useState({});
  const [preview, setPreview] = useState(null);
  const selected = definitions.filter(attribute => codes.includes(attribute.code));
  const valuesFor = attribute => options[attribute.code] ?? (attribute.options || []);
  function prepare() {
    try {
      const rows = generateProductVariants(codes, selected.map(attribute => ({
        ...attribute, options: valuesFor(attribute),
      })), variants);
      const keys = new Set(rows.map(row => row.key));
      const existing = new Set(variants.map(row => row.key));
      setPreview([
        ...rows.map(row => ({row, action: existing.has(row.key) ? 'Conservar' : 'Añadir'})),
        ...variants.filter(row => !keys.has(row.key)).map(row => ({
          row, action: 'Conservar',
        })),
      ]);
    } catch (error) {
      notify(error.message === 'too_many_variants'
        ? 'La selección supera 200 combinaciones. Reduce los valores.'
        : 'Selecciona al menos un valor por atributo.');
    }
  }
  return <div className="cat-variant-generation">
    {selected.map(attribute => <fieldset key={attribute.code} disabled={disabled}>
      <legend>{attribute.name}</legend>
      {(attribute.options || []).map(value => <label key={value}>
        <input type="checkbox" checked={valuesFor(attribute).includes(value)} onChange={event => {
          const values = valuesFor(attribute);
          setOptions({...options, [attribute.code]: event.target.checked
            ? [...values, value] : values.filter(item => item !== value)});
          setPreview(null);
        }}/>{value}
      </label>)}
    </fieldset>)}
    <button type="button" disabled={disabled || !selected.length} onClick={prepare}>Previsualizar combinaciones</button>
    {preview && <fieldset disabled={disabled}>
      <legend>Combinaciones previstas</legend>
      <ul>{preview.map(({row, action}, index) => <li key={row.key}>
        <label><input type="checkbox" checked={action === 'Añadir' || action === 'Conservar'} onChange={event => {
          const checked = event.target.checked;
          const alreadyExists = variants.some(variant => variant.key === row.key);
          const nextAction = checked ? (alreadyExists ? 'Conservar' : 'Añadir')
            : savedKeys.has(row.key) ? 'Desactivar' : alreadyExists ? 'Quitar' : 'Omitir';
          setPreview(preview.map((entry, position) => position === index ? {...entry, action: nextAction} : entry));
        }}/>{labelOf(row)} · {action}</label>
      </li>)}</ul>
      <button type="button" className="cat-primary" onClick={() => {
        const chosen = preview.filter(({action}) => action !== 'Quitar' && action !== 'Omitir');
        if (chosen.length > 200) {notify('El producto admite hasta 200 variantes.'); return;}
        onApply(chosen.map(({row, action}) => {
          const current = variants.find(variant => variant.key === row.key) || row;
          return action === 'Desactivar' ? {...current, active: false} : current;
        }));
        setPreview(null);
      }}>Aplicar combinaciones</button>
      <button type="button" onClick={() => setPreview(null)}>Cancelar vista previa</button>
    </fieldset>}
  </div>;
}

export default function CatalogVariantRows({variants, savedKeys, images, price, currency, disabled, onChange, onRemove, upload, notify}) {
  const duplicates = duplicateVariantSkus(variants);
  const number = new Intl.NumberFormat('es', {style: 'currency', currency, currencyDisplay: 'code', maximumFractionDigits: 6});
  return <div className="cat-full cat-variants">
    {!variants.length && <p>Crea una variante base, añade una combinación manual o genera combinaciones desde los atributos.</p>}
    {variants.map(row => {
      const label = labelOf(row);
      const duplicate = duplicates.has(skuOf(row));
      const patch = changes => onChange(row.key, changes);
      const photo = images.find(image => image.url === row.image_url);
      const finalPrice = Number(price) + Number(row.price_delta ?? 0);
      return <article className="cat-variant-card" key={row.key}>
        <div className="cat-variant-fields">
          <label>Combinación<input maxLength={160} value={label} disabled={disabled} onChange={event => patch({label: event.target.value})}/>
            {Object.keys(row.values || {}).length > 0 && <small>{Object.values(row.values).join(' · ')}</small>}
          </label>
          <div>
            <label>SKU<input maxLength={120} value={row.sku || ''} disabled={disabled} aria-invalid={duplicate} onChange={event => patch({sku: event.target.value})}/></label>
            {row.sku && <><div className="cat-variant-sku">{row.sku}</div><button type="button" onClick={async () => {
              try {await navigator.clipboard.writeText(row.sku); notify('SKU copiado.');}
              catch {notify('No se pudo copiar el SKU.');}
            }}>Copiar SKU</button></>}
            {duplicate && <small role="alert" className="cat-error">SKU duplicado en este producto</small>}
          </div>
          <label>Ajuste de precio<input type="number" step="0.000001" value={row.price_delta ?? 0} disabled={disabled} onChange={event => patch({price_delta: Number(event.target.value)})}/>
            Precio final <output>{price !== '' && price != null && Number.isFinite(finalPrice) ? number.format(finalPrice) : 'Pendiente'}</output>
          </label>
          <div>
            <label className="cat-variant-check"><input type="checkbox" checked={row.active !== false} disabled={disabled} onChange={event => patch({active: event.target.checked})}/>Activa</label>
            <small>Sin saldo por variante</small>
            {savedKeys.has(row.key) && row.active !== false && <button type="button" disabled={disabled} onClick={() => patch({active: false})}>Desactivar</button>}
            {!savedKeys.has(row.key) && <button type="button" className="cat-variant-remove" disabled={disabled} onClick={() => onRemove(row.key)}>Quitar</button>}
          </div>
        </div>
        {row.image_url && <img className="cat-variant-thumbnail" src={row.image_url} alt={`Imagen de ${label}`} loading="lazy"/>}
        <details className="cat-variant-media">
          <summary>{row.image_url ? 'Cambiar imagen' : 'Anexar imagen'} · {row.image_url ? (row.image_kind === 'compatible_cover' ? 'Portada compatible' : 'Foto asignada') : 'Imagen pendiente'}</summary>
          <label>Imagen de la galería<select disabled={disabled || !images.length} value={photo?.url || ''} onChange={event => {
            if (event.target.value) patch({image_url: event.target.value, image_kind: 'specific'});
          }}><option value="" disabled>Elegir imagen…</option>{images.map(image => <option key={image.url} value={image.url}>{image.name || image.url}</option>)}</select></label>
          {row.image_url && <label>Uso de la imagen<select disabled={disabled} value={row.image_kind || 'specific'} onChange={event => patch({image_kind: event.target.value})}>
            <option value="specific">Foto específica</option><option value="compatible_cover">Portada compatible</option>
          </select></label>}
          {upload ? <label>Subir archivo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => {
            const file = event.target.files[0];
            event.target.value = '';
            if (file) void upload(row.key, file);
          }}/></label> : <small>Guarda el producto para subir un archivo.</small>}
          {row.image_url && <button type="button" disabled={disabled} onClick={() => patch({image_url: null, image_kind: null})}>Desvincular imagen</button>}
        </details>
        <details className="cat-variant-detail">
          <summary>Detalle de presentación</summary>
          <div className="cat-variant-fields">
            <label>Contenido neto<input maxLength={80} value={row.net_content || ''} disabled={disabled} onChange={event => patch({net_content: event.target.value})}/></label>
            {[['packaging_unit', 'Empaque', productPackagingUnits], ['sale_unit', 'Unidad de venta', productSaleUnits]].map(([key, title, options]) => <label key={key}>{title}
              <select value={row[key] || ''} disabled={disabled} onChange={event => patch({[key]: event.target.value})}>
                <option value="">Sin definir</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>)}
            <label>Código de barras<input maxLength={80} value={row.barcode || ''} disabled={disabled} onChange={event => patch({barcode: event.target.value})}/></label>
          </div>
        </details>
      </article>;
    })}
  </div>;
}
