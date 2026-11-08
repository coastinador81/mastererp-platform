import type { FieldMap } from './types';

/**
 * «Procesamiento Inteligente de Documentos» (DocumentProcessor del original): lectura de
 * CSV, TXT, JSON y PDF (simulado) a partir del texto, y búsqueda de los campos faltantes.
 */

export const SUPPORTED_EXTENSIONS = ['csv', 'xlsx', 'xls', 'pdf', 'txt', 'json'] as const;
export type DocumentExtension = (typeof SUPPORTED_EXTENSIONS)[number];
export const DOCUMENT_ACCEPT = '.csv,.xlsx,.xls,.pdf,.txt,.json';

/** Extensión en minúsculas («Ficha.XLSX» → «xlsx»). */
export const extensionOf = (name: string): string => String(name).toLowerCase().split('.').pop() ?? '';

export const isSupportedDocument = (name: string): boolean => (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name));

/** Cabecera de columna → clave de campo («Peso Neto» → «peso_neto»). */
export const toFieldKey = (header: string): string => header.toLowerCase().replace(/\s+/g, '_');

const DELIMITERS = [',', '\t', '|', ';'];

/** Separador más frecuente fuera de comillas en la primera línea (papaparse lo detecta igual). */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  DELIMITERS.forEach(delimiter => {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  });
  return best;
}

/** Filas de un CSV (RFC 4180: comillas dobles, "" escapadas y saltos dentro de comillas). */
export function parseCSVRows(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Como papaparse con header: las líneas vacías no son filas de datos.
  return rows.filter(cells => cells.some(value => value.trim() !== ''));
}

/**
 * processCSV: la primera fila de datos con sus cabeceras como claves. Rechaza
 * «CSV vacío» si no hay filas de datos.
 */
export function parseCSVDocument(text: string): FieldMap {
  const [headers, first] = parseCSVRows(text);
  if (!headers || !first) throw new Error('CSV vacío');
  const data: FieldMap = {};
  headers.forEach((header, index) => {
    const value = first[index];
    if (value) data[toFieldKey(header)] = value;
  });
  return data;
}

/** processExcel: la primera fila (objeto columna → valor) con claves normalizadas. */
export function excelRowToFields(firstRow: Record<string, unknown> | undefined): FieldMap {
  if (!firstRow) throw new Error('Excel vacío');
  const data: FieldMap = {};
  Object.keys(firstRow).forEach(key => { data[toFieldKey(key)] = firstRow[key]; });
  return data;
}

/** processText: líneas «Clave: valor». */
export function parseTextDocument(text: string): FieldMap {
  const data: FieldMap = {};
  String(text).split('\n').forEach(line => {
    const match = line.match(/^(.+?):\s*(.+)$/);
    if (match) data[toFieldKey(match[1])] = match[2].trim();
  });
  return data;
}

/** processJSON: el objeto del archivo; «JSON inválido» si no se puede leer. */
export function parseJSONDocument(raw: unknown): FieldMap {
  if (typeof raw !== 'string') throw new Error('Formato inválido');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('JSON inválido');
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as FieldMap) : {};
}

/** processPDF (simulado como en el original): valores fijos según los campos faltantes. */
export function simulatedPdfData(missingFields: string[]): FieldMap {
  const data: FieldMap = {};
  missingFields.forEach(field => {
    switch (field) {
      case 'peso': data.peso = '2.5 kg'; break;
      case 'dimensiones': data.dimensiones = '45 x 30 x 25 cm'; break;
      case 'garantía': data['garantía'] = '24 meses'; break;
      case 'certificaciones': data.certificaciones = 'CE, RoHS, Energy Star'; break;
      case 'materiales': data.materiales = 'Acero inoxidable, Plástico ABS'; break;
      default: break;
    }
  });
  return data;
}

/** findMatchingFields: para cada campo buscado, la primera clave que se le parece. */
export function findMatchingFields(extracted: FieldMap, targetFields: string[]): FieldMap {
  const matched: FieldMap = {};
  targetFields.forEach(field => {
    const target = field.toLowerCase();
    const possibleKeys = Object.keys(extracted).filter(key => {
      const lower = key.toLowerCase();
      return lower.includes(target) || target.includes(lower) || lower.replace(/_/g, ' ') === target || target.replace(/_/g, ' ') === lower;
    });
    if (possibleKeys.length > 0) matched[field] = extracted[possibleKeys[0]];
  });
  return matched;
}

/** Campos que aplicará «Aplicar N Campos»: la unión de los archivos procesados. */
export function mergeExtracted(entries: Array<{ status: string; extractedData?: FieldMap }>): FieldMap {
  return entries.reduce<FieldMap>((all, entry) => (entry.status === 'success' && entry.extractedData ? { ...all, ...entry.extractedData } : all), {});
}
