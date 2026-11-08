import { Icon, InformationDisclosure } from '@/shared/ui';

/** Notas de Amazon (compactas): guía del sistema A+, normas y una sola alerta. */
export function AplusNotes({ asin }: { asin: string | undefined }) {
  return (
    <div className="pim-aplus-notes">
      <InformationDisclosure label="Guía de contenido A+"><div className="pim-aplus-guide">
        <Icon name="info" size={16} />
        <div className="pim-aplus-guide-items">
          <div className="pim-aplus-guide-item">
            <p className="pim-aplus-guide-title">✅ Sistema A+ Completo</p>
            <p>
              Carga contenido A+ existente con imágenes reales, edita módulos y publica directamente en Amazon. Las imágenes se descargan
              automáticamente desde Amazon.
            </p>
            <p>
              💡 ASIN <span className="pim-mono">{asin || '[ASIN]'}</span> debe estar activo en Amazon.es para asociar contenido A+.
            </p>
          </div>
          <div className="pim-aplus-guide-item">
            <p className="pim-aplus-guide-title">Normas Amazon A+</p>
            <p>
              • Imágenes: <span className="pim-mono">.jpg/.png/.bmp</span>, <span className="pim-mono">{'<2MB'}</span>, mín. 72ppp • Texto exclusivo •
              Sin precios ni comparaciones • Contenido de calidad premium
            </p>
          </div>
        </div>
      </div></InformationDisclosure>
      <InformationDisclosure label="Sobre las imágenes del borrador">
        <p>⚠️ Las imágenes en borradores A+ no son accesibles hasta publicar el contenido.</p>
      </InformationDisclosure>
    </div>
  );
}
