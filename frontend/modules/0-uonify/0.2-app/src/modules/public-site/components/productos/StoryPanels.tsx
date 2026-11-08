import { InterfaceCapture } from '../common/InterfaceCapture';
import { UonyPreview } from '../common/UonyPreview';
import { useState } from 'react';
import { TONE_DESCRIPTIONS, type Tone } from './productosContent';

const TONES: ReadonlyArray<{ tone: Tone; label: string }> = [
  { tone: 'cercano', label: 'Más cercano' },
  { tone: 'directo', label: 'Más directo' },
];

/** 03 / COMUNICA: ejemplo de descripción con dos tonos. */
export function WritingStory() {
  const [tone, setTone] = useState<Tone>('cercano');
  return (
    <article className="visual-story" id="contenido-producto">
      <div className="writing-stage">
        <InterfaceCapture view="producto-descripciones" />
        <p id="description-example" className="interface-editorial-copy" aria-live="polite">{TONE_DESCRIPTIONS[tone]}</p>
        <div className="writing-controls" role="group" aria-label="Ver ejemplos de tono">
          {TONES.map(item => (
            <button key={item.tone} type="button" data-tone={item.tone} aria-pressed={tone === item.tone} onClick={() => setTone(item.tone)}>{item.label}</button>
          ))}
        </div>
        <span className="stage-footnote">Ejemplos de contenido</span>
      </div>
      <div className="visual-story-copy">
        <span className="story-number">03 / COMUNICA</span>
        <h3>Encuentra las palabras{' '}<br />para cada producto.</h3>
        <p>Da forma a títulos y descripciones con ayuda de la IA. Ajusta el tono, compara propuestas y conserva el control del contenido.</p>
        <details className="feature-details">
          <summary>Explorar la creación de contenido <span aria-hidden="true">+</span></summary>
          <p>Descripciones vinculadas a la ficha, propuestas asistidas y edición del contenido. Las palabras acompañan a los datos del producto: puedes revisarlas y decidir qué conservar.</p>
        </details>
      </div>
    </article>
  );
}

/** 04 / REVISA Y PREPARA: revisión de la ficha antes de cada canal. */
export function ReviewStory() {
  return (
    <article className="review-story" id="canales">
      <div className="review-copy">
        <span className="story-number">04 / REVISA Y PREPARA</span>
        <h3>Antes de dar el paso,{' '}<br />ten la información clara.</h3>
        <p>Revisa atributos, detecta campos pendientes y prepara la ficha para sus canales. Cada producto conserva su contexto y tú decides cómo avanzar.</p>
        <details className="feature-details">
          <summary>De la revisión a cada canal <span aria-hidden="true">+</span></summary>
          <p>La auditoría de producto combina categorías, esquemas y datos de origen. La información validada puede incorporarse a los atributos, junto al contenido y los recursos que necesita cada canal.</p>
        </details>
      </div>
      <UonyPreview preview />
    </article>
  );
}
