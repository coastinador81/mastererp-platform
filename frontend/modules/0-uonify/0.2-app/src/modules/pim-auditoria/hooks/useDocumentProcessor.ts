import { useCallback, useState } from 'react';
import { readFileAsText, uid } from '@/shared/lib';
import { toast } from '@/shared/ui';
import type { FieldMap } from '../model/types';
import {
  excelRowToFields,
  extensionOf,
  findMatchingFields,
  isSupportedDocument,
  parseCSVDocument,
  parseJSONDocument,
  parseTextDocument,
  simulatedPdfData,
} from '../model/documents';
import { readFirstSheetRow } from '../api/spreadsheet';

export type DocumentStatus = 'processing' | 'success' | 'error';

export interface DocumentEntry {
  id: string;
  file: File;
  status: DocumentStatus;
  extractedData?: FieldMap;
  error?: string;
}

async function readText(file: File, errorMessage: string): Promise<string> {
  try {
    return await readFileAsText(file);
  } catch {
    throw new Error(errorMessage);
  }
}

/** Datos de un archivo según su extensión (processCSV/Excel/PDF/Text/JSON del original). */
async function extractDocument(file: File, missingFields: string[]): Promise<FieldMap> {
  switch (extensionOf(file.name)) {
    case 'csv': return parseCSVDocument(await readText(file, 'Error leyendo CSV'));
    case 'xlsx':
    case 'xls': return excelRowToFields(await readFirstSheetRow(file));
    case 'pdf':
      // Simulado como en el original: se lee el archivo y se devuelven valores fijos.
      await readText(file, 'Error leyendo PDF');
      return simulatedPdfData(missingFields);
    case 'txt': return parseTextDocument(await readText(file, 'Error leyendo texto'));
    case 'json': return parseJSONDocument(await readText(file, 'Error leyendo JSON'));
    default: return {};
  }
}

/**
 * Estado del «Procesamiento Inteligente de Documentos»: archivos, progreso (E29: avanza
 * con cada archivo) y los campos faltantes que se encuentran en cada uno.
 */
export function useDocumentProcessor(getMissingFields: () => string[]) {
  const [files, setFiles] = useState<DocumentEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const processFiles = useCallback(async (fileList: File[]) => {
    const validFiles = fileList.filter(file => isSupportedDocument(file.name));
    if (validFiles.length === 0) {
      toast.error('Tipo de archivo no soportado. Usa CSV, XLSX, PDF, TXT o JSON');
      return;
    }
    const entries: DocumentEntry[] = validFiles.map(file => ({ id: uid('doc'), file, status: 'processing' }));
    setFiles(current => [...current, ...entries]);
    setProcessing(true);
    setProgress(0);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      let next: DocumentEntry;
      try {
        const extracted = await extractDocument(entry.file, getMissingFields());
        next = { ...entry, status: 'success', extractedData: findMatchingFields(extracted, getMissingFields()) };
      } catch (error) {
        next = { ...entry, status: 'error', error: error instanceof Error ? error.message : 'Error desconocido' };
      }
      setFiles(current => current.map(item => (item.id === entry.id ? next : item)));
      setProgress(((index + 1) / entries.length) * 100);
    }
    setProcessing(false);
    toast.success(`${validFiles.length} archivo(s) procesado(s)`);
  }, [getMissingFields]);

  const removeFile = useCallback((id: string) => {
    setFiles(current => current.filter(entry => entry.id !== id));
  }, []);

  return { files, processing, progress, processFiles, removeFile };
}
