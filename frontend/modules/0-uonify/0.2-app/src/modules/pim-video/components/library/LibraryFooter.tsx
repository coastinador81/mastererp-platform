import { Icon } from '@/shared/ui';
import { AMAZON_ADS_CONNECTED } from '../../model/constants';
import { destinationOf } from '../../model/format';
import type { VideoItem } from '../../model/types';

/**
 * Pie con la única acción sólida de la vista (prototipo: footerHTML): la ficha se
 * sube a Seller Central (guía); el anuncio, hasta que exista la conexión con Amazon
 * Ads, se descarga listo para subirlo allí (decisión del dueño).
 */
interface LibraryFooterProps {
  video: VideoItem;
  onSellerCentral: () => void;
  onAds: () => void;
}

export function LibraryFooter({ video, onSellerCentral, onAds }: LibraryFooterProps) {
  const ads = destinationOf(video) === 'ads';
  let note = 'Amazon no permite subir los vídeos de la ficha desde otras aplicaciones: Uonify te lo deja preparado para Seller Central.';
  let label = 'Subir a Seller Central';
  let icon = 'upload-cloud';
  if (ads && AMAZON_ADS_CONNECTED) {
    note = 'Se envía a tu biblioteca de recursos de Amazon Ads para usarlo en tus campañas.';
    label = 'Enviar a Amazon Ads';
  } else if (ads) {
    note = 'Descárgalo y súbelo a tu biblioteca de recursos de Amazon Ads para usarlo en tus campañas.';
    label = 'Descargar para Amazon Ads';
    icon = 'download';
  }
  return (
    <div className="pim-video-footer">
      <p className="pim-video-note">{note}</p>
      <button type="button" className="pim-btn pim-btn-primary" onClick={ads ? onAds : onSellerCentral}><Icon name={icon} size={16} />{label}</button>
    </div>
  );
}
