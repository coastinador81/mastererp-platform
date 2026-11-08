import { useId } from 'react';
import clsx from 'clsx';
import { AiMark, Icon, toast } from '@/shared/ui';
import { amazonModel, applyAttributesLabel, applyAttributesToFields, optionalKeyToAdd, validAttributes } from '../model/amazon';
import { display, translateAttribute } from '../model/translations';
import { primaryOwner } from '../model/validation';
import { useAuditStore } from '../hooks/useAuditStore';
import { AmazonSummary } from './AmazonSummary';
import { AttributeField } from './AttributeField';

/** Opcionales que se enseñan como botones (el resto, «+N más»). */
const OPTIONAL_SHOWN = 10;

/**
 * «Atributos Amazon» (AmazonAttributesSection, E10-E17): resultado de la IA con su
 * marca, indicadores, atributos editables (faltantes primero), requeridos y opcionales
 * que faltan, recomendaciones y «Aplicar Atributos al Producto».
 */
export function AmazonAttributes() {
  const { audit, read, patch, customFields, setCustomFields } = useAuditStore();
  const uid = useId();
  const model = amazonModel(audit);
  const rowsCount = model.missingRows.length + model.existingRows.length;
  const optionalShown = model.missingOptional.slice(0, OPTIONAL_SHOWN);
  // Acción sólida mientras los atributos son la tarea abierta (sin sugerencia, selector ni esquema).
  const applyVariant = primaryOwner(audit) === 'attributes' ? 'pim-btn-primary' : 'pim-btn-outline';

  const updateAttribute = (key: string, value: unknown) => {
    patch({ amazonAttributes: { ...read().amazonAttributes, [key]: value } });
  };

  const addOptional = (attr: string) => {
    const key = optionalKeyToAdd(amazonModel(read()), attr);
    if (key !== null) updateAttribute(key, ''); // E15: no pisa un atributo que ya existe
  };

  const applyAttributes = () => {
    const valid = validAttributes(read().amazonAttributes);
    const count = Object.keys(valid).length;
    if (count > 0) {
      setCustomFields(applyAttributesToFields(customFields(), valid)); // E17
      toast.success(`✅ ${count} campos aplicados exitosamente! Revisa la pestaña Atributos.`);
    } else {
      toast.warning('⚠️ No hay atributos con valor para aplicar.');
    }
  };

  return (
    <section className="pim-section pim-auditoria-ai-result" aria-labelledby={`${uid}-amazon`}>
      <div className="pim-section-head">
        <div className="pim-auditoria-head-main">
          <h3 className="pim-section-title" id={`${uid}-amazon`}>
            <Icon name="package" size={16} />
            <span>Atributos Amazon - {model.productType.name}</span>
            <AiMark />
          </h3>
          <p className="pim-section-sub">Tipo: <span className="pim-mono">{model.detectedCategory}</span></p>
        </div>
      </div>
      <AmazonSummary model={model} />
      <section className="pim-auditoria-block" aria-labelledby={`${uid}-mapped`}>
        <h4 className="pim-auditoria-block-title" id={`${uid}-mapped`}>Atributos Mapeados ({rowsCount})</h4>
        {rowsCount > 0 ? (
          <div className="pim-auditoria-list" data-scroll="attrs">
            <div className="pim-auditoria-grid">
              {model.missingRows.map((row, index) => (
                <AttributeField
                  key={`m:${row.originalKey}:${index}`}
                  id={`${uid}-m${index}`}
                  label={row.label}
                  attrKey={row.originalKey}
                  focusKey="missing"
                  value={row.value}
                  badge={<span className="pim-badge pim-badge-red">FALTANTE</span>}
                  missing
                  onChange={updateAttribute}
                />
              ))}
              {model.existingRows.map((row, index) => (
                <AttributeField
                  key={`a:${row.key}`}
                  id={`${uid}-a${index}`}
                  label={row.label}
                  attrKey={row.key}
                  focusKey="attr"
                  value={row.value}
                  badge={<span className={clsx('pim-badge', row.isRequired && 'pim-badge-outline')}>{row.isRequired ? 'REQ' : 'OPT'}</span>}
                  onChange={updateAttribute}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {model.missingRequired.length > 0 ? (
        <section className="pim-auditoria-block" aria-labelledby={`${uid}-req`}>
          <h4 className="pim-auditoria-block-title" id={`${uid}-req`}>Atributos Requeridos Faltantes ({model.missingRequired.length})</h4>
          <div className="pim-auditoria-badges">
            {model.missingRequired.map((attr, index) => (
              <span key={`${attr}:${index}`} className="pim-badge pim-badge-red">{translateAttribute(attr)}</span>
            ))}
          </div>
        </section>
      ) : null}
      {model.missingOptional.length > 0 ? (
        <section className="pim-auditoria-block" aria-labelledby={`${uid}-opt`}>
          <div className="pim-auditoria-block-head">
            <h4 className="pim-auditoria-block-title" id={`${uid}-opt`}>Atributos Opcionales Faltantes ({model.missingOptional.length})</h4>
            <p className="pim-hint" id={`${uid}-opt-hint`}>Haz clic para agregar a atributos mapeados</p>
          </div>
          <div className="pim-auditoria-badges">
            {optionalShown.map((attr, index) => (
              <button
                key={`${attr}:${index}`}
                type="button"
                className="pim-auditoria-chip"
                data-focus={`opt:${attr}`}
                aria-describedby={`${uid}-opt-hint`}
                onClick={() => addOptional(attr)}
              >
                <Icon name="plus" size={12} />
                {translateAttribute(attr)}
              </button>
            ))}
            {model.missingOptional.length > OPTIONAL_SHOWN ? (
              <span className="pim-badge pim-auditoria-more">+{model.missingOptional.length - OPTIONAL_SHOWN} más</span>
            ) : null}
          </div>
        </section>
      ) : null}
      {model.recommendations.length > 0 ? (
        <section className="pim-auditoria-block" aria-labelledby={`${uid}-rec`}>
          <h4 className="pim-auditoria-block-title" id={`${uid}-rec`}>💡 Recomendaciones</h4>
          <ul className="pim-auditoria-recs">
            {model.recommendations.map((rec, index) => (
              <li key={index}>
                <span className="pim-auditoria-rec-n">{index + 1}.</span>
                <span>{display(rec)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="pim-auditoria-footer">
        <p className="pim-auditoria-footer-note">Se aplicarán todos los atributos con valor al producto</p>
        <button type="button" className={clsx('pim-btn', applyVariant)} data-focus="apply-attributes" onClick={applyAttributes}>
          <Icon name="zap" size={16} />
          <span data-region="apply-label">{applyAttributesLabel(model)}</span>
        </button>
      </div>
    </section>
  );
}
