import React, {useEffect, useRef, useState} from 'react';

function Preview({src, name}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? <span role="status">No se pudo cargar la imagen.</span> : <img src={src} alt={name} onError={() => setFailed(true)}/>;
}

export default function CatalogImageGallery({value, onChange, disabled}) {
  const [files, setFiles] = useState([]), [error, setError] = useState('');
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);
  function choose(list) {
    const incoming = Array.from(list);
    if (!incoming.length) return;
    if (incoming.length > 8 || incoming.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError('Selecciona hasta 8 imágenes JPG, PNG o WebP de máximo 5 MB cada una.'); return;
    }
    urls.current.forEach(URL.revokeObjectURL);
    const next = incoming.map(file => ({name: file.name, url: URL.createObjectURL(file)}));
    urls.current = next.map(file => file.url); setFiles(next); setError('');
  }
  const valid = /^(https:\/\/|\/images\/)/.test(value || '');
  return <div className="cat-full cat-gallery">
    <div className="cat-gallery-grid">
      <figure className="cat-gallery-cover">
        <div className="cat-gallery-preview">{valid ? <Preview src={value} name="Imagen principal del producto"/> : <span>Sin imagen principal</span>}</div>
        <figcaption><strong>Imagen principal</strong><span>Se publica al guardar el producto.</span></figcaption>
        {value && <button type="button" disabled={disabled} onClick={() => onChange(null)}>Quitar imagen principal</button>}
      </figure>
      {files.map(file => <figure key={file.url}>
        <div className="cat-gallery-preview"><Preview src={file.url} name={file.name}/></div>
        <figcaption><strong>{file.name}</strong><span>Vista previa local · no publicada</span></figcaption>
        <button type="button" disabled={disabled} onClick={() => {URL.revokeObjectURL(file.url); urls.current = urls.current.filter(url => url !== file.url); setFiles(current => current.filter(item => item.url !== file.url));}}>Quitar vista previa</button>
      </figure>)}
    </div>
    <details><summary>{value ? 'Cambiar imagen principal por enlace' : 'Añadir imagen principal por enlace'}</summary>
      <label>Enlace de una imagen alojada<input type="text" value={value || ''} pattern="(https://.+|/images/.+)" placeholder="https://…" disabled={disabled} onChange={event => onChange(event.target.value || null)}/></label>
      <p>El catálogo admite una imagen principal alojada. Las imágenes adicionales de esta galería son vistas previas locales.</p>
    </details>
    <div className="cat-upload" onDragOver={event => event.preventDefault()} onDrop={event => {event.preventDefault(); if (!disabled) choose(event.dataTransfer.files);}}>
      <strong>Arrastra imágenes para previsualizarlas</strong><p>JPG, PNG o WebP · hasta 8 archivos de 5 MB. La subida de archivos todavía no está disponible; estos archivos no se guardan ni se publican.</p>
      <label>Buscar archivos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled} onChange={event => choose(event.target.files)}/></label>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
