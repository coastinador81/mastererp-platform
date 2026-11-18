import React, {useEffect, useRef, useState} from 'react';

function Preview({src, name}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? <span role="status">No se pudo cargar la imagen.</span> : <img src={src} alt={name} onError={() => setFailed(true)}/>;
}

export default function CatalogImageGallery({value, onChange, disabled}) {
  const [previews, setPreviews] = useState([]), [error, setError] = useState('');
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);
  function choose(list) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    if (incoming.length > 8 || incoming.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError('Selecciona hasta 8 imágenes JPG, PNG o WebP de máximo 5 MB cada una.');
      return;
    }
    urls.current.forEach(URL.revokeObjectURL);
    const next = incoming.map(file => ({name: file.name, url: URL.createObjectURL(file)}));
    urls.current = next.map(file => file.url);
    setPreviews(next);
    setError('');
  }
  const persisted = /^(https:\/\/|\/images\/)/.test(value || '');
  return <div className="cat-full cat-gallery">
    <div className="cat-gallery-heading"><div><strong>Galería del producto</strong><span>Haz clic en una imagen publicada para elegirla como portada.</span></div><label className="cat-gallery-add">Añadir imágenes<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled} onChange={event => choose(event.target.files)}/></label></div>
    <div className="cat-gallery-grid">
      {persisted && <button type="button" className="cat-gallery-card is-cover" disabled={disabled} onClick={() => onChange(value)} aria-label="Imagen principal actual"><span className="cat-gallery-preview"><Preview src={value} name="Imagen principal del producto"/></span><span className="cat-gallery-meta"><strong>Imagen principal</strong><small>Portada actual</small></span><span className="cat-cover-badge">Principal</span></button>}
      {previews.map(file => <div className="cat-gallery-card is-preview" key={file.url}><span className="cat-gallery-preview"><Preview src={file.url} name={file.name}/></span><span className="cat-gallery-meta"><strong>{file.name}</strong><small>Vista previa pendiente de carga</small></span><button type="button" disabled={disabled} onClick={() => {URL.revokeObjectURL(file.url); urls.current = urls.current.filter(url => url !== file.url); setPreviews(current => current.filter(item => item.url !== file.url));}}>Quitar</button></div>)}
      {!persisted && !previews.length && <div className="cat-gallery-empty"><strong>Este producto todavía no tiene imágenes</strong><span>Añade fotografías para preparar su galería.</span></div>}
    </div>
    <div className="cat-upload" onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); if (!disabled) choose(event.dataTransfer.files);}}><strong>Arrastra aquí las imágenes</strong><p>JPG, PNG o WebP · hasta 8 archivos de 5 MB.</p></div>
    {persisted && <button className="cat-gallery-remove" type="button" disabled={disabled} onClick={() => onChange(null)}>Quitar imagen principal</button>}
    {previews.length > 0 && <p className="cat-gallery-pending">Estas vistas previas aún no se publican. La carga persistente de la galería se habilitará con el contrato de medios del catálogo.</p>}
    {error && <p role="alert" className="cat-error">{error}</p>}
  </div>;
}
