import { useLayoutEffect, useRef, useState } from 'react';
import { Badge, Dialog, Icon } from '@/shared/ui';
import { useAplusController } from '../../hooks/aplusContext';
import type { EcosystemData } from '../../model/ecosystem';

/**
 * Generador de contenido de Uony (E33): datos del producto que usará y opciones de
 * generación. A06: mientras genera no se puede cerrar (ni con la X, ni con Escape,
 * ni pulsando fuera), igual que «Cancelar».
 */
function Row({ label, value, extra = '' }: { label: string; value: string; extra?: string }) {
  return (
    <div className="pim-aplus-ai-row">
      <dt>{label}</dt>
      <dd className={`pim-aplus-ai-val${extra}`}>{value}</dd>
    </div>
  );
}

const shortValue = (value: string) => value.slice(0, 20) + (value.length > 20 ? '...' : '');

function EcosystemSection({ data }: { data: EcosystemData }) {
  const attrs = data.customAttributes;
  return (
    <section className="pim-aplus-ai-sec pim-aplus-ai-eco">
      <h3 className="pim-aplus-ai-h">Datos del ecosistema disponibles</h3>
      <div className="pim-aplus-ai-grid">
        <dl className="pim-kv pim-aplus-ai-col">
          <Row label="Nombre" value={data.name} extra=" pim-aplus-ai-val-truncate" />
          <Row label="Categoría" value={data.category} />
          {data.brand ? <Row label="Marca" value={data.brand} /> : null}
        </dl>
        <dl className="pim-kv pim-aplus-ai-col">
          <Row label="Atributos" value={`${attrs.length} campos`} />
          <Row label="Imágenes" value={`${data.availableImages.length} disponibles`} />
          {data.sku ? <Row label="SKU" value={data.sku} extra=" pim-mono" /> : null}
        </dl>
      </div>
      {attrs.length > 0 ? (
        <div className="pim-aplus-ai-attrs">
          <p>Atributos clave detectados:</p>
          <div className="pim-aplus-ai-badges">
            {attrs.slice(0, 4).map((attr, i) => (
              <Badge tone="outline" key={i}>{`${attr.name}: ${shortValue(attr.value)}`}</Badge>
            ))}
            {attrs.length > 4 ? <Badge>{`+${attrs.length - 4} más`}</Badge> : null}
          </div>
        </div>
      ) : null}
      <p className="pim-aplus-ai-note">
        <Icon name="uony" size={14} />
        <span>
          <strong>UONY:</strong> Datos conectados automáticamente desde las pestañas Atributos e Imágenes del producto actual.
        </span>
      </p>
    </section>
  );
}

function OptionsSection() {
  return (
    <section className="pim-aplus-ai-sec pim-aplus-ai-options">
      <h3 className="pim-aplus-ai-h">Opciones de generación con Uony</h3>
      <div className="pim-aplus-ai-option pim-aplus-ai-option-active">
        <div>
          <h4>
            <Icon name="uony" size={16} />
            Generación con Uony
          </h4>
          <p>Genera contenido usando datos reales de atributos, categoría, marca y características del producto</p>
          <div className="pim-aplus-ai-badges">
            <Badge tone="ai">IA Avanzada</Badge>
            <Badge>Datos reales</Badge>
          </div>
        </div>
        <Badge tone="blue">Activo</Badge>
      </div>
      <div className="pim-aplus-ai-option pim-aplus-ai-option-soon">
        <div>
          <h4>
            <Icon name="image" size={16} />
            Integración con imágenes
          </h4>
          <p>Sugiere contenido basado en las imágenes subidas del producto</p>
        </div>
        <Badge tone="outline">Bajo solicitud</Badge>
      </div>
      <div className="pim-aplus-ai-option pim-aplus-ai-option-soon">
        <div>
          <h4>
            <Icon name="check-circle" size={16} />
            Optimización A+
          </h4>
          <p>Analiza y optimiza el contenido para cumplir normas Amazon A+</p>
        </div>
        <Badge tone="outline">Bajo solicitud</Badge>
      </div>
      <div className="pim-aplus-ai-algo">
        <h4>Algoritmo de generación activo</h4>
        <div className="pim-aplus-ai-algo-grid">
          <div><span>Fuente: </span><strong>Atributos + Descripción</strong></div>
          <div><span>Estilo: </span><strong>Profesional A+</strong></div>
          <div><span>Límites: </span><strong>Amazon A+</strong></div>
        </div>
      </div>
    </section>
  );
}

export function AiGeneratorDialog({ moduleId, onClose }: { moduleId: string; onClose: () => void }) {
  const controller = useAplusController();
  const [data] = useState(() => controller.ecosystem(moduleId));
  const [generating, setGenerating] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // La X del diálogo es del kit: se desactiva aquí mientras Uony genera.
  useLayoutEffect(() => {
    const dialogEl = bodyRef.current?.closest('dialog');
    const close = dialogEl?.querySelector<HTMLButtonElement>('[data-dialog-close]');
    if (close) close.disabled = generating;
    dialogEl?.setAttribute('aria-busy', String(generating));
  }, [generating]);

  const requestClose = () => {
    if (!generating) onClose();
  };
  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    const applied = await controller.generate(moduleId, onClose);
    if (!applied) setGenerating(false);
  };

  return (
    <Dialog
      open
      onClose={requestClose}
      className="pim-aplus-dialog pim-aplus-dialog-2xl"
      title={
        <span className="pim-aplus-dlg-title">
          <span className="pim-ai-mark pim-aplus-ai-mark">
            <Icon name="uony" size={14} />
          </span>
          Generador de contenido de Uony
        </span>
      }
    >
      <div className="pim-aplus-dlg" ref={bodyRef}>
        <div className="pim-aplus-ai-body">
          <EcosystemSection data={data} />
          <OptionsSection />
          <div className="pim-aplus-ai-foot">
            <p>Los campos actuales se sobrescribirán</p>
            <div className="pim-aplus-ai-foot-actions">
              <button type="button" className="pim-btn pim-btn-outline" disabled={generating} onClick={requestClose}>
                Cancelar
              </button>
              <button type="button" className="pim-btn pim-btn-ai" disabled={generating} onClick={() => void generate()}>
                <Icon name={generating ? 'loader' : 'uony'} size={16} className={generating ? 'pim-spin' : undefined} />
                {generating ? 'Generando...' : 'Generar contenido'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
