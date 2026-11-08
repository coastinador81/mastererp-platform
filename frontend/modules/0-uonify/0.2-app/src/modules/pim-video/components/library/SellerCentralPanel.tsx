import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { MARKETPLACE } from '@/shared/api/config';
import { Icon, dialog } from '@/shared/ui';
import { copyText } from '../../lib/clipboard';
import { saveFile } from '../../lib/media';
import { SELLER_CENTRAL } from '../../model/constants';
import { formatSize, languageLabel } from '../../model/format';
import type { VideoItem } from '../../model/types';

/**
 * «Subir a Seller Central» (prototipo: pim/video.js, openSellerCentral). Amazon no
 * permite subir los vídeos de la ficha desde otras aplicaciones (SP-API): guía con la
 * descarga, el enlace a «Subir y gestionar vídeos» y los datos listos para copiar.
 */
interface PanelProps {
  video: VideoItem;
  asin: string;
  fileName: string;
}

type CopyField = 'title' | 'asin';
const COPY_LABELS: Record<CopyField, string> = { title: 'Título', asin: 'ASIN' };

export const sellerCentralUrl = (countryCode: string = MARKETPLACE.countryCode): string =>
  `https://${SELLER_CENTRAL[String(countryCode || 'ES').toUpperCase()] || SELLER_CENTRAL.ES}/creatorhub/video/library/`;

function CopyButton({ field, value, copied, onCopy }: { field: CopyField; value: string; copied: boolean; onCopy: (field: CopyField, value: string, from: HTMLElement) => void }) {
  const label = COPY_LABELS[field];
  return (
    <button
      type="button"
      className="pim-btn pim-btn-ghost pim-btn-icon pim-btn-sm"
      aria-label={copied ? `${label} copiado` : `Copiar ${label === 'ASIN' ? 'ASIN' : label.toLowerCase()}`}
      data-tooltip="Copiar"
      data-tooltip-align="end"
      onClick={(event: MouseEvent<HTMLButtonElement>) => onCopy(field, value, event.currentTarget)}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  );
}

export function SellerCentralPanel({ video, asin, fileName }: PanelProps) {
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState<CopyField | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const title = String(video.title || '').trim();

  const onCopy = async (field: CopyField, value: string, from: HTMLElement) => {
    const ok = await copyText(value, from);
    setStatus(ok ? `${COPY_LABELS[field]} copiado.` : 'No se pudo copiar: selecciónalo y cópialo a mano.');
    if (!ok) return;
    setCopied(field);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div className="pim-video-upload">
      <ol className="pim-video-upload-steps">
        <li>
          <div className="pim-video-upload-step"><strong>Descarga el vídeo</strong><span className="pim-mono">{fileName} · {formatSize(video.size)}</span></div>
          <div className="pim-section-actions">
            <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" onClick={() => void saveFile(video.url, fileName)}><Icon name="download" size={14} />Descargar vídeo</button>
            {video.poster ? (
              <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm" onClick={() => void saveFile(video.poster, `${fileName.replace(/\.[^.]+$/, '')}-miniatura.jpg`)}><Icon name="image" size={14} />Descargar miniatura</button>
            ) : null}
          </div>
        </li>
        <li>
          <div className="pim-video-upload-step"><strong>Abre «Subir y gestionar vídeos»</strong><span>En Seller Central, con tu cuenta de vendedor.</span></div>
          <div className="pim-section-actions">
            <a className="pim-btn pim-btn-outline pim-btn-sm" href={sellerCentralUrl()} target="_blank" rel="noopener noreferrer"><Icon name="external-link" size={14} />Abrir Seller Central<span className="pim-sr-only"> (se abre en otra pestaña)</span></a>
          </div>
        </li>
        <li>
          <div className="pim-video-upload-step"><strong>Copia los datos del vídeo</strong></div>
          <dl className="pim-video-upload-data">
            <div><dt>Título</dt><dd>{title}</dd><CopyButton field="title" value={title} copied={copied === 'title'} onCopy={(f, v, el) => void onCopy(f, v, el)} /></div>
            <div><dt>ASIN</dt><dd className="pim-mono">{asin}</dd><CopyButton field="asin" value={asin} copied={copied === 'asin'} onCopy={(f, v, el) => void onCopy(f, v, el)} /></div>
            <div><dt>Idioma</dt><dd>{languageLabel(video.language || 'es')}</dd></div>
          </dl>
        </li>
      </ol>
      <p className="pim-video-note">Amazon revisa el vídeo antes de mostrarlo en la ficha: entre 1 y 7 días hábiles.</p>
      <p className="pim-sr-only" role="status">{status}</p>
    </div>
  );
}

export function openSellerCentralDialog(props: PanelProps): void {
  dialog.open({
    title: 'Subir a Seller Central',
    description: 'Amazon no permite subir los vídeos de la ficha desde otras aplicaciones. Uonify te lo deja todo preparado.',
    body: <SellerCentralPanel {...props} />,
    size: 'md',
    actions: [{ label: 'Hecho', variant: 'primary' }],
  });
}
