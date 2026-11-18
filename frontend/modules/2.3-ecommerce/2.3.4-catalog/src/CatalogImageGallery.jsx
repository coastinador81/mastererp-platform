import React, {useState} from 'react';

function Preview({src, name}) {return <img src={src} alt={name} loading="lazy"/>;}

export default function CatalogImageGallery({images = [], coverUrl, onChange, upload, disabled, saved}) {
  const [error, setError] = useState(''), [uploading, setUploading] = useState(false);
  const normalized = images.length ? images : coverUrl ? [{id: 'legacy', name: 'Imagen principal', url: coverUrl}] : [];
  const cover = coverUrl || normalized[0]?.url || null;
  const commit = (next, nextCover) => onChange(next, nextCover || next[0]?.url || null);
  async function choose(list) {
    const files = Array.from(list);
    if (!files.length) return;
    if (!saved) {setError('Guarda primero el producto para poder añadir imágenes.'); return;}
    if (normalized.length + files.length > 8 || files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {setError('La galería admite hasta 8 imágenes JPG, PNG o WebP de máximo 5 MB.'); return;}
    setUploading(true); setError('');
    try {const added = []; for (const file of files) added.push(await upload(file)); const next = [...normalized, ...added]; commit(next, cover || added[0]?.url);}
    catch {setError('No se pudieron cargar las imágenes. Intenta nuevamente.');}
    finally {setUploading(false);}
  }
  return <div className="cat-full cat-gallery">
    <div className="cat-gallery-heading"><div><strong>Galería del producto</strong><span>Selecciona una imagen para usarla como portada.</span></div><label className={`cat-gallery-add ${(disabled || uploading || !saved) ? 'is-disabled' : ''}`}>{uploading ? 'Cargando…' : 'Añadir imágenes'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || uploading || !saved} onChange={event => {choose(event.target.files); event.target.value = '';}}/></label></div>
    <div className={`cat-gallery-grid ${normalized.length ? '' : 'is-empty'}`} onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); if (!disabled && !uploading) choose(event.dataTransfer.files);}}>
      {normalized.map(image => <article className={`cat-gallery-card ${image.url === cover ? 'is-cover' : ''}`} key={image.id || image.url}>
        <button className="cat-gallery-select" type="button" disabled={disabled || uploading} onClick={() => commit(normalized, image.url)} aria-label={`Usar ${image.name || 'imagen'} como portada`}><span className="cat-gallery-preview"><Preview src={image.url} name={image.name || 'Imagen del producto'}/></span><span className="cat-gallery-meta"><strong>{image.name || 'Imagen del producto'}</strong><small>{image.url === cover ? 'Portada actual' : 'Seleccionar como portada'}</small></span>{image.url === cover && <span className="cat-cover-badge">Principal</span>}</button>
        <button className="cat-gallery-remove" type="button" disabled={disabled || uploading} onClick={() => {const next = normalized.filter(item => item !== image); commit(next, image.url === cover ? next[0]?.url : cover);}}>Quitar</button>
      </article>)}
      {!normalized.length && <div className="cat-gallery-empty"><strong>Este producto todavía no tiene imágenes</strong><span>{saved ? 'Arrastra fotografías aquí o usa «Añadir imágenes».' : 'Guarda el producto y luego añade sus fotografías.'}</span><small>JPG, PNG o WebP · hasta 8 archivos de 5 MB.</small></div>}
    </div>
    {error && <p role="alert" className="cat-error">{error}</p>}
  </div>;
}
