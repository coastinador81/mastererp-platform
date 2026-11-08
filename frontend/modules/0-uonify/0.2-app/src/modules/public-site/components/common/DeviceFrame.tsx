/**
 * Marco de dispositivo para enseñar una interfaz de Uonify. Si llega una captura real
 * (`src`), se muestra; si no, un HUECO DISEÑADO (panel con una ilustración del manual y
 * una etiqueta), listo para cambiarlo en un solo sitio cuando haya captura.
 */
export function DeviceFrame({ src, illo, label, alt }: { src?: string; illo: string; label: string; alt: string }) {
  return (
    <div className="device-frame">
      <div className="device-bar"><i /><i /><i /><em>dev.uonify.com</em></div>
      <div className="device-body">
        {src
          ? <img className="device-shot" src={src} alt={alt} loading="lazy" />
          : (
            <div className="device-hueco" role="img" aria-label={label}>
              <img src={`/assets/product-icons/${illo}.png`} width="120" height="120" alt="" loading="lazy" />
              <span>{label}</span>
            </div>
          )}
      </div>
    </div>
  );
}
