/**
 * Lectura de hojas de cálculo (XLSX/XLS) del «Procesamiento Inteligente de Documentos».
 * Como el prototipo, SheetJS se carga bajo demanda solo cuando se sube una hoja (el
 * proyecto no lo tiene como dependencia). Se usa la distribución oficial 0.20.3: la
 * 0.18.5 del prototipo (la última en npm) tiene fallos de seguridad conocidos al leer
 * archivos manipulados. El CSV se lee sin librerías (model/documents.ts).
 */
const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

interface SheetJS {
  read(data: Uint8Array, options: { type: 'array' }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(sheet: unknown): Array<Record<string, unknown>> };
}

let sheetPromise: Promise<SheetJS> | null = null;

function loadSheetJS(): Promise<SheetJS> {
  sheetPromise ??= import(/* @vite-ignore */ SHEETJS_URL)
    .then((mod: { read?: unknown; default?: unknown }) => (mod.read ? mod : mod.default) as SheetJS)
    .catch((error: unknown) => {
      sheetPromise = null;
      throw error;
    });
  return sheetPromise;
}

/** Primera fila de la primera hoja como objeto columna → valor (undefined si está vacía). */
export async function readFirstSheetRow(file: File): Promise<Record<string, unknown> | undefined> {
  const XLSX = await loadSheetJS();
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error('Error leyendo Excel');
  }
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(worksheet)[0];
}
