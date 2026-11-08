import type { CSSProperties } from 'react';

/** Bandas de la ilustración A+ (posición, alto y fundido de cada tira, del PROTO). */
const BANDS: ReadonlyArray<{ n: string; width: number; height: number; top: string; fade: string }> = [
  { n: '01', width: 2170, height: 725, top: '0.000000000%', fade: '0.000000000%' },
  { n: '02', width: 2170, height: 725, top: '9.852670350%', fade: '11.570247934%' },
  { n: '03', width: 2168, height: 725, top: '19.751381215%', fade: '11.157024793%' },
  { n: '04', width: 2170, height: 725, top: '29.604051565%', fade: '11.570247934%' },
  { n: '05', width: 2170, height: 725, top: '39.502762431%', fade: '11.157024793%' },
  { n: '06', width: 2170, height: 725, top: '49.355432781%', fade: '11.570247934%' },
  { n: '07', width: 2170, height: 725, top: '59.254143646%', fade: '11.157024793%' },
  { n: '08', width: 2169, height: 725, top: '69.106813996%', fade: '11.570247934%' },
  { n: '09', width: 2170, height: 725, top: '79.005524862%', fade: '11.157024793%' },
  { n: '10', width: 2171, height: 724, top: '88.858195212%', fade: '11.570247934%' },
];
const BAND_HEIGHT = '11.141804788%';

/** Escenas del A+ con texto nativo (siempre nítido sobre la ilustración). */
const SCENES: ReadonlyArray<{ key: string; title: readonly string[]; copy: readonly string[]; wordmark?: boolean }> = [
  { key: 'opening', title: ['Todo', 'empieza', 'jugando.'], copy: ['Las mismas piezas.', 'Más de una manera', 'de crear.'], wordmark: true },
  { key: 'turn', title: ['Tu turno.'], copy: ['Una pieza puede', 'cambiarlo todo.'] },
  { key: 'fall', title: ['¡Ups!', 'Esto también', 'es jugar.'], copy: ['A veces, la mejor idea', 'empieza al caer.'] },
  { key: 'rebuild', title: ['Mismas piezas.', 'Otra idea.'], copy: ['Combina sus formas', 'y descubre lo que', 'podéis crear.'] },
  { key: 'finale', title: ['¿Qué', 'creamos', 'ahora?'], copy: ['Apila. Combina.', 'Vuelve a imaginar.'] },
];

const lines = (parts: readonly string[]) => parts.flatMap((part, index) => (index ? [<br key={index} />, part] : [part]));

/** Panel «Contenido A+»: una mesa, una partida. */
export function GalleryAplus({ hidden }: { hidden: boolean }) {
  return (
    <div id="gallery-aplus" className="gallery-panel" role="tabpanel" aria-labelledby="gallery-tab-aplus" tabIndex={0} hidden={hidden}>
      <div className="aplus-hd" role="group" aria-label="Una mesa, una partida">
        <div className="aplus-hd-artwork" role="img" aria-label="Dos personas apilan las piezas de madera de Uonify, se turnan, reaccionan a la caída de la torre y reconstruyen los personajes.">
          {BANDS.map(band => (
            <img
              key={band.n}
              className="aplus-hd-band"
              src={`/assets/jenga/aplus-v54-hd/uonify-band-${band.n}.png`}
              width={band.width}
              height={band.height}
              style={{ '--band-top': band.top, '--band-height': BAND_HEIGHT, '--band-fade': band.fade } as CSSProperties}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
        {SCENES.map(scene => (
          <section key={scene.key} className={`aplus-hd-scene aplus-hd-${scene.key}`} aria-labelledby={`aplus-hd-${scene.key}-title`}>
            <div className="aplus-hd-copy">
              {scene.wordmark ? <span className="aplus-hd-wordmark">uonify</span> : null}
              <h4 id={`aplus-hd-${scene.key}-title`}>{lines(scene.title)}</h4>
              <p>{lines(scene.copy)}</p>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
