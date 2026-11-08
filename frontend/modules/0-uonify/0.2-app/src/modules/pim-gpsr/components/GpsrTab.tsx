import { useId } from 'react';
import clsx from 'clsx';
import { usePimSlice, useTabContext } from '@/shared/pim';
import { Icon, Switch, toast } from '@/shared/ui';
import { updateGPSR } from '../api/gpsrApi';
import { CONTENT_TYPES, MONO_FIELDS, buildGpsrPayload, mergeGpsr, type GpsrData, type GpsrField } from '../model/gpsr';
import '../styles/gpsr.css';

type TextFieldName = Exclude<GpsrField, 'content_type' | 'safety_attestation'>;

/**
 * Pestaña «GPSR» (prototipo: pim/gpsr.js). Decisión del dueño: el formulario se
 * ve siempre, en cualquier producto y también en «Nuevo Producto», sin cuenta de
 * Amazon. Lo editado vive en la porción `gpsr` del producto (se guarda en cada
 * cambio y sigue al producto al crearlo); si no hay, lo importado de Amazon o
 * los valores vacíos.
 */
export function GpsrTab() {
  const ctx = useTabContext();
  const product = ctx.isNew ? null : ctx.product;
  const [stored, setStored] = usePimSlice<Partial<GpsrData> | null>('gpsr', null);
  const gpsrData = mergeGpsr(stored, product);
  const id = `pim-gpsr${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const update = <K extends GpsrField>(field: K, value: GpsrData[K]) => setStored({ ...gpsrData, [field]: value });

  // Sin estado de carga ni bloqueo, como el original; la respuesta llega aunque se salga de la pestaña.
  const save = async () => {
    try {
      // En «Nuevo Producto» el SKU y el tipo salen del borrador que se está creando.
      const target = (product ?? (typeof ctx.draft === 'function' ? ctx.draft() : null) ?? {}) as Record<string, unknown>;
      await updateGPSR(buildGpsrPayload(target, gpsrData));
      toast.success('✅ GPSR actualizado en Amazon');
    } catch (error) {
      toast.error(`❌ Error actualizando GPSR: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const textField = (field: TextFieldName, label: string, placeholder: string, wide: boolean) => (
    <div className={clsx('pim-field pim-gpsr-field', wide && 'pim-gpsr-wide')}>
      <label className="pim-label" htmlFor={`${id}-${field}`}>{label}</label>
      <input
        className={clsx('pim-input', MONO_FIELDS.has(field) && 'pim-mono')}
        id={`${id}-${field}`}
        data-gpsr-field={field}
        value={gpsrData[field] ?? ''}
        placeholder={placeholder}
        autoComplete="off"
        onChange={event => update(field, event.target.value)}
      />
    </div>
  );

  return (
    <div className="pim-gpsr-root">
      <header className="pim-head">
        <h2 id={`${id}-title`}>
          <Icon name="shield" size={18} className="pim-gpsr-head-icon" />
          <span>GPSR - Cumplimiento y Seguridad</span>
        </h2>
      </header>
      <section className="pim-section pim-gpsr-form" aria-labelledby={`${id}-title`}>
        <div className="pim-gpsr-grid">
          {textField('manufacturer_contact', 'Dirección electrónica o de correo electrónico del fabricante', 'compliance@fabricante.com o https://fabricante.com/contacto', true)}
          {textField('eu_responsible_address', 'Correo electrónico o dirección electrónica de la persona responsable', 'responsable@empresa.eu o https://empresa.eu/responsable', true)}
          {textField('compliance_document_url', 'Ubicación de origen de los medios de cumplimiento', 'https://ejemplo.com/compliance.pdf', true)}
          <div className="pim-field pim-gpsr-field">
            <label className="pim-label" htmlFor={`${id}-content_type`}>Tipo de contenido de medios de cumplimiento</label>
            <select
              className="pim-select"
              id={`${id}-content_type`}
              data-gpsr-field="content_type"
              value={gpsrData.content_type || 'user_manual'}
              onChange={event => update('content_type', event.target.value)}
            >
              <option value="" disabled hidden>Seleccionar tipo</option>
              {CONTENT_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </div>
          {textField('content_language', 'Idioma de los medios de cumplimiento', 'es_ES', false)}
          <div className="pim-gpsr-switch-row pim-gpsr-wide">
            <label className="pim-gpsr-switch-label" id={`${id}-safety_attestation-label`} htmlFor={`${id}-safety_attestation`}>
              Certificación de Seguridad
            </label>
            <Switch
              id={`${id}-safety_attestation`}
              data-gpsr-field="safety_attestation"
              checked={Boolean(gpsrData.safety_attestation)}
              aria-labelledby={`${id}-safety_attestation-label`}
              onCheckedChange={checked => update('safety_attestation', checked)}
            />
          </div>
        </div>
      </section>
      <div className="pim-gpsr-actions">
        <button type="button" className="pim-btn pim-btn-primary pim-gpsr-save" data-gpsr-save="" onClick={() => void save()}>
          <Icon name="shield" size={16} />
          <span>Guardar GPSR en Amazon</span>
        </button>
      </div>
    </div>
  );
}
