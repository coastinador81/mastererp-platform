import { useState } from 'react';
import { usePimStore } from '@/shared/pim';
import { Icon } from '@/shared/ui';
import { useProducts } from '../api/queries';
import { fingerprint, guideDraft } from './draft';
import { GUIDE_FOLDER, GUIDE_SKU, type Guide } from './model';
import { useGuideStore } from './store';
import { GuidePreview } from './GuidePreview';
import { amazonPublicationUrl } from './publication';
import './guide.css';

interface Props { threadId: string; send(text: string): void; openProduct(sku: string): void; requestChanges(): void; pause(): void }
const STAGES = ['Datos y descripción', 'Imágenes del producto', 'Contenido A+', 'Vídeo y revisión'];
export function GuideCard(props: Props) {
  const guide = useGuideStore(state => state.guides[props.threadId]);
  return guide ? <ActiveGuideCard {...props} guide={guide} /> : null;
}
function ActiveGuideCard({ threadId, send, openProduct, requestChanges, pause, guide }: Props & { guide: Guide }) {
  const [folder, setFolder] = useState('');
  useProducts();
  usePimStore(guide?.sku || GUIDE_SKU);
  const sku = guide.sku || GUIDE_SKU;
  const product = guideDraft(sku);
  const changedSincePublication = Boolean(guide.published && guide.published !== fingerprint(sku));
  const published = guide.step === 'published' && !changedSincePublication;
  const publicationUrl = amazonPublicationUrl(guide.publicationUrl);
  const reviewed = Boolean(guide.reviewed && guide.reviewed === fingerprint(sku));
  const action = (label: string, message: string, primary = false) => <button type="button" className={primary ? 'uony-guide-action' : 'uony-guide-link'} disabled={guide.busy} onClick={() => send(message)}>{label.includes('Uony') && <Icon name="uony" />}{label}</button>;
  return <section className="uony-guide" aria-label="Preparar producto con Uony" aria-busy={guide.busy}>
    <header className="uony-guide-heading"><img src="/assets/brands/uonify-isotipo-3d.webp" width="26" height="17" alt="" /><strong>Con Uony</strong><span>Amazon.es</span></header>
    {guide.error && <p className="uony-guide-error" role="alert">{guide.error}</p>}
    {guide.paused ? <><h3>Tu trabajo está guardado</h3><p>Retoma el recorrido cuando quieras.</p>{action('Continuar con Uony', 'Continúa', true)}</> : <>
      {(guide.step === 'amazon' || guide.step === 'drive') && <>
        <div className="uony-guide-connection">
          <div className="uony-guide-provider" aria-hidden="true">{guide.step === 'amazon' ? <img src="/assets/brands/amazon-logo.svg" alt="" /> : <Icon name="folder" />}</div>
          <div className="uony-guide-connection-copy"><h3>{guide.step === 'amazon' ? 'Amazon Seller Central' : 'Google Drive'}</h3><p>{guide.step === 'amazon' ? 'Conecta tu cuenta de vendedor para publicar cuando lo apruebes.' : 'Conecta tu cuenta para elegir los archivos del producto.'}</p></div>
        </div>
        {action(guide.busy ? 'Conectando…' : guide.step === 'amazon' ? 'Conectar Amazon' : 'Conectar Google Drive', guide.step === 'amazon' ? 'Conectar Amazon' : 'Conectar Google Drive', true)}
      </>}
      {guide.step === 'folder' && <>
        <h3>Encuentra tu producto</h3><p>Dime la carpeta por voz o escríbela aquí.</p>
        <form onSubmit={event => { event.preventDefault(); if (folder.trim()) send(folder.trim()); }}>
          <label htmlFor={`guide-folder-${threadId}`}>Carpeta de Google Drive</label>
          <input id={`guide-folder-${threadId}`} value={folder} onChange={event => setFolder(event.target.value)} placeholder={GUIDE_FOLDER} maxLength={500} required />
          <button className="uony-guide-action" disabled={guide.busy} type="submit"><Icon name="uony" />{guide.busy ? 'Buscando…' : 'Buscar con Uony'}</button>
        </form>
        {action(`Usar ${GUIDE_FOLDER}`, GUIDE_FOLDER)}
      </>}
      {guide.step === 'files' && <>
        <h3>Este es tu producto</h3>
        <div className="uony-guide-product"><img src="/assets/jenga/ficha/UON-KIT-01.MAIN.jpg" alt="Juego Make It Possible de Uonify" /><div><strong>Make It Possible</strong><p>25 piezas de madera · Uonify</p><small>{guide.folder}</small></div></div>
        <ul className="uony-guide-files"><li>Ficha y características del producto</li><li>8 imágenes para la galería</li><li>5 módulos de contenido A+</li><li>Vídeo «Todo empieza jugando» · 27 s</li></ul>
        <div className="uony-guide-actions">
          {action('Preparar ficha con Uony', 'Prepara la ficha', true)}
          {action('Elegir otra carpeta', 'Otra carpeta')}
        </div>
      </>}
      {guide.step === 'preparing' && <>
        <h3>Uony está preparando tu ficha</h3><p>Puedes seguir aquí o abrir Producto para ver el borrador.</p>
        <ol className="uony-guide-progress">{STAGES.map((label, index) => <li key={label} data-complete={guide.progress > index}><span>{guide.progress > index ? '✓' : index + 1}</span>{label}</li>)}</ol>
        <button type="button" className="uony-guide-link" onClick={pause}>Pausar preparación</button>
      </>}
      {(['ready', 'published', 'preview'].includes(guide.step)) && <>
        <div className="uony-guide-product"><img src={product?.image || '/assets/jenga/ficha/UON-KIT-01.MAIN.jpg'} alt="Producto Uonify" /><div><span className="uony-guide-eyebrow">{published ? publicationUrl ? 'PUBLICADO EN AMAZON' : 'RECORRIDO COMPLETADO' : 'LISTO PARA REVISAR'}</span><strong>{product?.name || 'Make It Possible'}</strong><p>Imágenes · Contenido A+ · Vídeo</p></div></div>
        {published ? <div className="uony-guide-completion">
          {publicationUrl ? <a className="uony-guide-action" href={publicationUrl} target="_blank" rel="noopener noreferrer">Ver producto en Amazon <span aria-hidden="true">↗</span></a>
            : <p>El enlace del producto aún no está disponible.</p>}
        </div> : <GuidePreview sku={sku} decision={{ reviewed, published: Boolean(guide.published && !changedSincePublication), busy: guide.busy,
          requestChanges, openProduct: () => openProduct(sku),
          review: () => send('Revisar la vista previa'), approve: () => send('Aprobar y publicar'),
        }} />}
      </>}
      {guide.step === 'publishing' && <div role="status"><h3>Publicando tu producto…</h3><p>Esperando la confirmación de Amazon.</p></div>}
    </>}
    {guide.sku && <footer><button type="button" className="uony-guide-link" onClick={() => openProduct(sku)}>Abrir en Producto <span aria-hidden="true">↗</span></button></footer>}
  </section>;
}
