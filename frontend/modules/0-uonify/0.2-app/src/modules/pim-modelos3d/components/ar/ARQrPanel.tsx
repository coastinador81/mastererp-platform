import { useState } from 'react';
import { Icon } from '@/shared/ui';
import { arLinks } from '../../model/ar';

const STEPS: [string, string, string][] = [
  ['1', 'Abre la cámara', 'En iOS usa la app Cámara, en Android usa Chrome'],
  ['2', 'Escanea el QR', 'Apunta hacia el código QR hasta que aparezca la notificación'],
  ['3', 'Toca para abrir', 'Se abrirá la experiencia AR directamente en tu navegador'],
  ['4', 'Coloca el objeto', 'Mueve el dispositivo para encontrar una superficie y colocar el producto'],
];
const FEATURES = ['Rotación 360° interactiva', 'Escalado táctil (pellizco)', 'Iluminación realista', 'Detección de superficies'];

/** «Código QR»: escanear con el móvil, instrucciones y características AR. */
export function ARQrPanel({ name }: { name: string }) {
  const [{ qrSrc }] = useState(() => arLinks(name));
  return (
    <div className="pim-modelos3d-argrid2">
      <section className="pim-modelos3d-group">
        <h3 className="pim-modelos3d-grouptitle"><Icon name="m3d-smartphone" size={18} /> Escanear con Móvil</h3>
        <p className="pim-modelos3d-groupdesc">Usa tu smartphone para ver el producto en realidad aumentada</p>
        <div className="pim-modelos3d-centered">
          <div className="pim-modelos3d-qr">
            <img src={qrSrc} alt="QR Code AR" width={192} height={192} />
            <span className="pim-modelos3d-live"><i className="pim-modelos3d-dot is-live pim-modelos3d-pulse" aria-hidden="true" />Activo</span>
          </div>
          <p className="pim-modelos3d-text">Apunta tu cámara al código QR</p>
          <p className="pim-modelos3d-xs">Compatible con iOS Safari y Android Chrome</p>
        </div>
      </section>
      <section className="pim-modelos3d-group">
        <h3 className="pim-modelos3d-grouptitle"><Icon name="eye" size={18} /> Instrucciones</h3>
        <ol className="pim-modelos3d-steps">
          {STEPS.map(([number, title, text]) => (
            <li key={number}>
              <span className="pim-modelos3d-step-n" aria-hidden="true">{number}</span>
              <div><strong>{title}</strong><p>{text}</p></div>
            </li>
          ))}
        </ol>
        <div className="pim-modelos3d-features">
          <h4 className="pim-modelos3d-subtitle"><Icon name="settings" size={16} /> Características AR</h4>
          <ul>
            {FEATURES.map(text => <li key={text}><i className="pim-modelos3d-dot" aria-hidden="true" />{text}</li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}
