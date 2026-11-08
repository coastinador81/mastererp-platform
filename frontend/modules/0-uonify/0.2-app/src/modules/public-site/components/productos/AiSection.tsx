import { InterfaceCapture, type InterfaceView } from '../common/InterfaceCapture';
import { useState } from 'react';
import { AI_SCENE_BUTTONS, AI_SCENES, type AiSceneKey } from './productosContent';

const VIEWS: Record<AiSceneKey, InterfaceView> = { revisar: 'uony-revision', contenido: 'producto-descripciones', organizar: 'producto-atributos' };

/**
 * Uony con la tecnología de Google: conversación de ejemplo con tres escenas. Cambiar
 * de escena actualiza la petición, la respuesta de Uony y el resultado, y lo anuncia.
 */
export function AiSection() {
  const [sceneKey, setSceneKey] = useState<AiSceneKey>('revisar');
  const [announcement, setAnnouncement] = useState('');
  const scene = AI_SCENES[sceneKey];
  const choose = (key: AiSceneKey) => {
    const next = AI_SCENES[key];
    setSceneKey(key);
    setAnnouncement(`${next.request} ${next.answer} ${next.state}`);
  };
  return (
    <section className="ai-section" id="inteligencia" aria-labelledby="ai-title">
      <div className="wrap">
        <div className="section-heading">
          <img className="section-character" src="/assets/productos/hive.png" width="100" height="100" alt="Agentes de Uonify" loading="lazy" />
          <p className="eyebrow">UONY · CON TECNOLOGÍA DE GOOGLE</p>
          <h2 id="ai-title">Toda la potencia de Uonify.{' '}<br /><span>En una conversación.</span></h2>
          <p>Lo que quieres hacer, con tus propias palabras. Una experiencia para trabajar con tus productos y las herramientas de Uonify a través de la inteligencia artificial.</p>
        </div>
        <div className="ai-demonstration">
          <div>
            <InterfaceCapture view={VIEWS[sceneKey]} />
            <div className="interface-editorial-copy" aria-live="polite">
              <p id="ai-request">{scene.request}</p><p id="ai-answer">{scene.answer}</p>
              <p id="ai-result"><strong>{scene.title.join(' ')}</strong> · <span className="result-state">{scene.state}</span></p>
            </div>
          </div>
          <div className="ai-scene-index">
            <p className="eyebrow">IMAGINA LO QUE PUEDES PEDIR</p>
            <h3>Una conversación.{' '}<br />Muchas formas{' '}<br />de avanzar.</h3>
            <div className="ai-scenarios" role="group" aria-label="Ejemplos de trabajo con Uony">
              {AI_SCENE_BUTTONS.map(item => (
                <button key={item.key} type="button" data-ai-scene={item.key} aria-pressed={sceneKey === item.key} onClick={() => choose(item.key)}>
                  <span>{item.number}</span><div><strong>{item.title}</strong><small>{item.copy}</small></div><i aria-hidden="true">↗</i>
                </button>
              ))}
            </div>
            <p className="ai-note">Tú marcas la intención. Uonify aporta el contexto.{' '}<br />La inteligencia artificial te ayuda a avanzar.</p>
          </div>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
        </div>
        <p className="interaction-note">Explora el recorrido con el juego de Uonify. Tú revisas el resultado antes de aprobarlo.</p>
      </div>
    </section>
  );
}
