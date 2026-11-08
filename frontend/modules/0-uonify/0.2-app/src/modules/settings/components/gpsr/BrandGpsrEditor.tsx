import { Alert, Checkbox, Field, Input, Section, SectionHead, Select } from '@/shared/ui';
import {
  EU_COUNTRY_OPTIONS, MANUFACTURER_COUNTRIES, RESPONSIBLE_TYPES,
  manufacturerInEu, validateBrandProfile,
  type BrandGpsrProfile, type BrandProfileErrors, type EuResponsible, type PostalAddress,
} from '../../model/brandGpsrProfile';

const EMPTY_RESPONSIBLE: EuResponsible = { type: 'importer', name: '', postalAddress: { street: '', postalCode: '', city: '', country: '' }, email: '' };
const opts = (list: ReadonlyArray<readonly [string, string]>) => list.map(([value, label]) => ({ value, label }));

/** Dirección postal estructurada (calle · CP + ciudad · país). A nivel de módulo para no perder el foco al teclear. */
function AddressFields({ addr, keyName, countries, errors, onChange }:
  { addr: PostalAddress; keyName: string; countries: ReadonlyArray<readonly [string, string]>; errors: BrandProfileErrors; onChange: (patch: Partial<PostalAddress>) => void }) {
  return (
    <>
      <Field label="Dirección postal" error={errors[`${keyName}.street`]}>
        <Input value={addr.street} invalid={!!errors[`${keyName}.street`]} placeholder="Calle y número" onChange={e => onChange({ street: e.target.value })} />
      </Field>
      <div className="pim-grid-2">
        <Field label="Código postal" error={errors[`${keyName}.postalCode`]}>
          <Input value={addr.postalCode} invalid={!!errors[`${keyName}.postalCode`]} onChange={e => onChange({ postalCode: e.target.value })} />
        </Field>
        <Field label="Ciudad" error={errors[`${keyName}.city`]}>
          <Input value={addr.city} invalid={!!errors[`${keyName}.city`]} onChange={e => onChange({ city: e.target.value })} />
        </Field>
      </div>
      <Field label="País" error={errors[`${keyName}.country`]}>
        <Select value={addr.country} invalid={!!errors[`${keyName}.country`]} placeholder="Elige el país…" options={opts(countries)} onChange={e => onChange({ country: e.target.value })} />
      </Field>
    </>
  );
}

/**
 * Formulario «GPSR por marca» (maqueta, D-UX-DESIGN-VIA-FRONTEND) con el sistema de
 * diseño real de Uonify (Section/SectionHead/Alert + escala del sistema), misma
 * dirección que la pestaña GPSR de la ficha. Son DEFAULTS reutilizables: el
 * fabricante y la persona responsable se guardan una vez y los productos de la
 * marca los HEREDAN. Dirección estructurada con país, correo OBLIGATORIO, y
 * responsable en la UE CONDICIONAL (solo si el fabricante está fuera de la UE). El
 * cumplimiento en Amazon (Brand Registry + vía B) se confirma al publicar en
 * Amazon, no aquí. Presentacional; el /api/brands real lo construye Producto.
 */
export function BrandGpsrEditor({ value, onChange }:
  { value: BrandGpsrProfile; onChange?: (next: BrandGpsrProfile) => void }) {
  const errors = validateBrandProfile(value);
  const emit = (patch: Partial<BrandGpsrProfile>) => onChange?.({ ...value, ...patch });
  const setManufacturer = (patch: Partial<BrandGpsrProfile['manufacturer']>) => emit({ manufacturer: { ...value.manufacturer, ...patch } });
  const resp = value.euResponsible ?? EMPTY_RESPONSIBLE;
  const setResponsible = (patch: Partial<EuResponsible>) => emit({ euResponsible: { ...resp, ...patch } });

  return (
    <div className="pim-tab">
      <Section>
        <SectionHead icon="tag" title="Datos reutilizables de la marca"
          subtitle="Se guardan una vez y se heredan en los productos de esta marca; cada ficha los muestra y puede ajustarlos." />
        <Field label="Marca" error={errors.brand}>
          <Input value={value.brand} invalid={!!errors.brand} placeholder="Basic Mini Bricks" onChange={e => emit({ brand: e.target.value })} />
        </Field>
      </Section>

      <Section>
        <SectionHead icon="shield" title="Fabricante"
          subtitle="Quien fabrica el producto. Si está fuera de la UE, hará falta una persona responsable en la UE." />
        <Field label="Nombre o razón social" error={errors['manufacturer.name']}>
          <Input value={value.manufacturer.name} invalid={!!errors['manufacturer.name']} onChange={e => setManufacturer({ name: e.target.value })} />
        </Field>
        <AddressFields addr={value.manufacturer.postalAddress} keyName="manufacturer.postalAddress" countries={MANUFACTURER_COUNTRIES} errors={errors}
          onChange={patch => setManufacturer({ postalAddress: { ...value.manufacturer.postalAddress, ...patch } })} />
        <Field label="Correo electrónico" hint="La ley exige un correo (no vale solo una web)." error={errors['manufacturer.email']}>
          <Input value={value.manufacturer.email} mono invalid={!!errors['manufacturer.email']} placeholder="calidad@empresa.com" onChange={e => setManufacturer({ email: e.target.value })} />
        </Field>
        <Field label="Persona de contacto (opcional)">
          <Input value={value.manufacturer.pointOfContact} onChange={e => setManufacturer({ pointOfContact: e.target.value })} />
        </Field>
      </Section>

      <Section>
        <SectionHead icon="globe" title="Persona responsable en la UE" />
        {!value.manufacturer.postalAddress.country ? (
          <Alert tone="info">Elige el país del fabricante para saber si hace falta.</Alert>
        ) : manufacturerInEu(value) ? (
          <Alert tone="green">El fabricante está en la UE: no hace falta una persona responsable.</Alert>
        ) : (<>
          <Alert tone="amber">El fabricante está fuera de la UE: añade la persona responsable en la UE.</Alert>
          <Field label="Tipo">
            <Select value={resp.type} options={opts(RESPONSIBLE_TYPES)} onChange={e => setResponsible({ type: e.target.value as EuResponsible['type'] })} />
          </Field>
          <Field label="Nombre o razón social" error={errors['euResponsible.name']}>
            <Input value={resp.name} invalid={!!errors['euResponsible.name']} onChange={e => setResponsible({ name: e.target.value })} />
          </Field>
          <AddressFields addr={resp.postalAddress} keyName="euResponsible.postalAddress" countries={EU_COUNTRY_OPTIONS} errors={errors}
            onChange={patch => setResponsible({ postalAddress: { ...resp.postalAddress, ...patch } })} />
          <Field label="Correo electrónico" error={errors['euResponsible.email']}>
            <Input value={resp.email} mono invalid={!!errors['euResponsible.email']} placeholder="responsable@empresa.com" onChange={e => setResponsible({ email: e.target.value })} />
          </Field>
        </>)}
      </Section>

      <Section>
        <SectionHead icon="copy" title="Aplicar a los productos" />
        <Checkbox checked={value.autoApply} onCheckedChange={v => emit({ autoApply: v })} label="Aplicar estos datos a los productos de esta marca." />
        <Alert tone="info">El cumplimiento en Amazon (alta en Seller Central) se confirma al publicar en Amazon, no aquí.</Alert>
      </Section>
    </div>
  );
}
