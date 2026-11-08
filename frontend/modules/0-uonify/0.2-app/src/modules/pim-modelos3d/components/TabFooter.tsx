import { Icon } from '@/shared/ui';
import { ModelNotes, type ModelNote } from './ModelNotes';

const TAB_NOTES: ModelNote[] = [
  {
    icon: 'm3d-circle-check',
    title: 'Formatos Soportados',
    text: <>GLB, glTF con materiales PBR y texturas hasta <span className="pim-mono">4096x4096</span></>,
  },
  { icon: 'layers', title: 'Optimización Automática', text: 'Validación de geometría, texturas y alineación' },
];

const AI_BADGES = ['Texturas 2048-4096px', 'Máx 200k triángulos', 'Vista AR compatible', 'Extensiones glTF'];

/** Notas y sección «Generación avanzada con Uony» al pie de la pestaña. */
export function TabFooter() {
  return (
    <>
      <ModelNotes items={TAB_NOTES} />
      <section className="pim-section is-divided">
        <div className="pim-section-head">
          <div>
            <h3 className="pim-section-title">
              <span className="pim-modelos3d-ai-icon"><Icon name="uony" size={16} /></span> Generación avanzada con Uony
            </h3>
            <p className="pim-modelos3d-text">
              Uony, la IA de Uonify, analiza tus imágenes y genera modelos 3D optimizados con materiales PBR, texturas de alta resolución y alineación automática.
            </p>
          </div>
        </div>
        <div className="pim-modelos3d-badges">
          {AI_BADGES.map(badge => <span className="pim-badge pim-badge-outline" key={badge}>{badge}</span>)}
        </div>
      </section>
    </>
  );
}
