import { useMemo } from 'react';
import { Alert, Badge, Button, Checkbox, Field, Icon, Input, Section, SectionHead, Select } from '@/shared/ui';
import {
  EU_COUNTRIES, IDENTIFIER_TYPES, MULTILINGUAL, SELLER_DECLARATION, countryName, gateMessage,
  validateProductGpsr, type IdentifierType, type ProductGpsrData, type SafetyWarning,
} from '../model/gpsrProfile';
import '../styles/gpsr-profile.css';

/** Códigos de la puerta UE derivados en local para la vista (el real lo da el backend). */
function localMissing(data: ProductGpsrData, brandComplete: boolean): string[] {
  const missing: string[] = [];
  if (!brandComplete) missing.push('brand_');
  if (!data.model.trim()) missing.push('model');
  if (!data.identifier.trim()) missing.push('identifier');
  if (!data.hasImage) missing.push('image');
  if (!data.saleCountries.length) missing.push('countries_of_sale');
  if (!data.noWarningsNeeded) {
    for (const iso2 of data.saleCountries) {
      const langs = EU_COUNTRIES.find(c => c.iso2 === iso2)?.languages ?? [];
      const has = data.warnings.some(w => w.text.trim() && langs.includes(w.language));
      if (!has) missing.push(MULTILINGUAL.has(iso2) ? `warnings_review_${iso2}` : `warnings_${iso2}`);
    }
  }
  if (!data.sellerDeclaration) missing.push('seller_declaration');
  return missing;
}

/** Resumen de los operadores heredados de la marca (defaults que pre-rellenan el producto). */
export interface BrandDefaults {
  manufacturerName: string;
  manufacturerEmail: string;
  /** null = el fabricante está en la UE y no hace falta responsable. */
  responsible: { name: string; email: string } | null;
}

/**
 * Pestaña «GPSR» del producto (Reglamento UE 2023/988), con el sistema de diseño
 * real de Uonify (Section/SectionHead/Alert, escala tipográfica del sistema). Es la
 * CAPTURA/MAESTRO del GPSR: el fabricante y la persona responsable se HEREDAN de la
 * marca (defaults, misma fuente), y aquí se añade lo del producto (advertencias,
 * países) y se refleja la PUERTA DE PUBLICACIÓN UE; la tienda UE y Amazon CONSUMEN
 * estos datos sin volver a pedirlos. La vía B de Amazon vive en la publicación de
 * Amazon, no aquí. Textos legales exactos de Legal.
 */
export function GpsrEditor({ data, brandComplete, brandDefaults, onChange, onOpenBrand }:
  { data: ProductGpsrData; brandComplete: boolean; brandDefaults?: BrandDefaults; onChange?: (next: ProductGpsrData) => void; onOpenBrand?: () => void }) {
  const errors = validateProductGpsr(data);
  const missing = useMemo(() => localMissing(data, brandComplete), [data, brandComplete]);
  const emit = (next: Partial<ProductGpsrData>) => onChange?.({ ...data, ...next });

  const availableLangs = [...new Set(data.saleCountries.flatMap(iso2 => EU_COUNTRIES.find(c => c.iso2 === iso2)?.languages ?? []))];
  const unselected = EU_COUNTRIES.filter(c => !data.saleCountries.includes(c.iso2));
  const setWarning = (i: number, patch: Partial<SafetyWarning>) =>
    emit({ warnings: data.warnings.map((w, j) => (j === i ? { ...w, ...patch, aiProposed: patch.text !== undefined ? false : w.aiProposed } : w)) });

  return (
    <div className="pim-tab">
      <Section>
        <SectionHead icon="shield" title="Fabricante y persona responsable"
          subtitle={`Se heredan de la marca «${data.brand || '—'}» y se aplican a todos sus productos.`} />
        {brandComplete && brandDefaults ? (
          <Alert tone="info" title={`De la marca «${data.brand}»`}>
            <dl className="pim-gpsr-kv">
              <div><dt>Fabricante</dt><dd>{brandDefaults.manufacturerName} · {brandDefaults.manufacturerEmail}</dd></div>
              <div><dt>Responsable en la UE</dt><dd>{brandDefaults.responsible
                ? `${brandDefaults.responsible.name} · ${brandDefaults.responsible.email}`
                : 'No hace falta: el fabricante está en la UE.'}</dd></div>
            </dl>
            <Button variant="ghost" size="sm" onClick={onOpenBrand}>Editar la marca</Button>
          </Alert>
        ) : (
          <Alert tone="amber">Completa el fabricante y la persona responsable en la marca «{data.brand || '—'}» para poder publicar en la UE.{' '}
            <Button variant="primary" size="sm" onClick={onOpenBrand}>Completar la marca</Button></Alert>
        )}
      </Section>

      <Section>
        <SectionHead icon="package" title="Datos del producto" />
        <div className="pim-grid-2">
          <Field label="Modelo o tipo" error={errors.itemErrors.model}>
            <Input value={data.model} invalid={!!errors.itemErrors.model} placeholder="Set de 500 piezas" onChange={e => emit({ model: e.target.value })} />
          </Field>
          <Field label="Tipo de identificador" hint="Para Amazon hace falta un EAN o un GTIN.">
            <Select value={data.identifierType} options={IDENTIFIER_TYPES.map(([value, label]) => ({ value, label }))} onChange={e => emit({ identifierType: e.target.value as IdentifierType })} />
          </Field>
        </div>
        <Field label="Identificador" error={errors.itemErrors.identifier}>
          <Input value={data.identifier} mono invalid={!!errors.itemErrors.identifier} placeholder="8414600500005" onChange={e => emit({ identifier: e.target.value })} />
        </Field>
        <Alert tone={data.hasImage ? 'green' : 'amber'} className="pim-gpsr-inline">
          {data.hasImage ? 'Hay al menos una imagen (de la pestaña Imágenes).' : 'Falta al menos una imagen (añádela en la pestaña Imágenes).'}
        </Alert>
      </Section>

      <Section>
        <SectionHead icon="globe" title="Países de venta en la UE" subtitle="Determinan en qué lenguas hacen falta las advertencias." />
        <div className="pim-gpsr-countries">
          {data.saleCountries.map(iso2 => (
            <span key={iso2} className="pim-gpsr-chip">{countryName(iso2)}
              <button type="button" aria-label={`Quitar ${countryName(iso2)}`} onClick={() => emit({ saleCountries: data.saleCountries.filter(c => c !== iso2) })}><Icon name="x" size={13} /></button></span>
          ))}
          {unselected.length ? (
            <select className="pim-select pim-gpsr-add-country" aria-label="Añadir país de venta" value="" onChange={e => e.target.value && emit({ saleCountries: [...data.saleCountries, e.target.value] })}>
              <option value="">+ Añadir país…</option>
              {unselected.map(c => <option key={c.iso2} value={c.iso2}>{c.name}</option>)}
            </select>
          ) : null}
        </div>
        {errors.itemErrors.saleCountries ? <p className="pim-error-text" role="alert">{errors.itemErrors.saleCountries}</p> : null}
      </Section>

      <Section>
        <SectionHead icon="alert-triangle" title="Advertencias de seguridad"
          subtitle="Una por lengua, copiadas del fabricante. Una traducción propuesta por Uony se marca «revísala»." />
        <Checkbox checked={data.noWarningsNeeded} onCheckedChange={v => emit({ noWarningsNeeded: v })}
          label="Este producto no necesita advertencias (art. 9.7)." />
        {!data.noWarningsNeeded ? (<>
          <div className="pim-gpsr-warnings">
            {data.warnings.map((w, i) => (
              <div key={i} className="pim-gpsr-warning">
                <select className="pim-select" aria-label={`Lengua de la advertencia ${i + 1}`} value={w.language} onChange={e => setWarning(i, { language: e.target.value })}>
                  <option value="">Lengua…</option>
                  {(availableLangs.length ? availableLangs : ['es_ES']).map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <input className="pim-input" value={w.text} placeholder="No apto para menores de 3 años." aria-label={`Texto de la advertencia ${i + 1}`} onChange={e => setWarning(i, { text: e.target.value })} />
                {w.aiProposed ? <Badge tone="ai">Traducción de Uony · revísala</Badge> : null}
                <button type="button" className="pim-gpsr-warning-remove" aria-label={`Quitar la advertencia ${i + 1}`} onClick={() => emit({ warnings: data.warnings.filter((_, j) => j !== i) })}><Icon name="trash" size={15} /></button>
              </div>
            ))}
          </div>
          <Button onClick={() => emit({ warnings: [...data.warnings, { language: '', text: '' }] })} icon="plus">Añadir advertencia</Button>
          {errors.itemErrors.warnings ? <p className="pim-error-text" role="alert">{errors.itemErrors.warnings}</p> : null}
        </>) : null}
      </Section>

      <Section>
        <SectionHead icon="check-circle" title="Tu declaración" />
        <Checkbox checked={data.sellerDeclaration} onCheckedChange={v => emit({ sellerDeclaration: v })} label={SELLER_DECLARATION.es} />
        {errors.itemErrors.sellerDeclaration ? <p className="pim-error-text" role="alert">{errors.itemErrors.sellerDeclaration}</p> : null}
      </Section>

      <Section>
        <SectionHead icon="upload" title="Publicación en la UE"
          actions={<Badge tone={missing.length ? 'amber' : 'green'}>{missing.length ? `${missing.length} por completar` : 'Lista para la UE'}</Badge>} />
        {missing.length ? (
          <Alert tone="amber" title="Para publicar en la UE falta:">
            <ul className="pim-gpsr-gate-list">{missing.map((code, i) => <li key={i}>{gateMessage(code)}</li>)}</ul>
            <p className="pim-small pim-muted">Fuera de la UE puedes publicar igualmente; se mostrará lo que falta.</p>
          </Alert>
        ) : <Alert tone="green">Cumple el GPSR de la UE. La tienda UE y Amazon tomarán estos datos al publicar.</Alert>}
      </Section>
    </div>
  );
}
