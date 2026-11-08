/**
 * Archivos en el navegador (prototipo: pim/core.js, util.readFileAsDataURL,
 * util.readFileAsText y util.download).
 */

function readFile(file: Blob, mode: 'dataURL' | 'text'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    if (mode === 'dataURL') reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

/** Lee un archivo como URL «data:» (vista previa de imágenes, subidas locales). */
export function readFileAsDataURL(file: Blob): Promise<string> {
  return readFile(file, 'dataURL');
}

/** Lee un archivo como texto (CSV, JSON, HTML…). */
export function readFileAsText(file: Blob): Promise<string> {
  return readFile(file, 'text');
}

/** Guarda una URL (data:, blob: o http) como archivo en el dispositivo de la persona. */
export function download(url: string, filename = 'archivo'): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
