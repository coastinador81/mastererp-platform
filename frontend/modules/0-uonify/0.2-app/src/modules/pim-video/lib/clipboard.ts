/**
 * Copiar al portapapeles sin avisos flotantes (prototipo: pim/video.js, copyText):
 * dentro de un diálogo, el aviso quedaría detrás. Si la API no está disponible, se
 * copia con un área de texto temporal dentro del mismo diálogo.
 */
export async function copyText(text: string, from: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const previous = document.activeElement as HTMLElement | null;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'pim-sr-only';
    (from.closest('dialog') || document.body).appendChild(area);
    area.select();
    let ok: boolean;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    (previous && previous.isConnected ? previous : from).focus({ preventScroll: true });
    return ok;
  }
}
