/** Etapas editoriales que muestran capturas del cliente actual. */
export type ScaleStepKey = 'receive' | 'enrich' | 'review' | 'publish';

export const SCALE_TABS: ReadonlyArray<{ key: ScaleStepKey; number: string; title: string; copy: string }> = [
  { key: 'receive', number: '01', title: 'Reunir', copy: 'Fuentes y catálogos' },
  { key: 'enrich', number: '02', title: 'Enriquecer', copy: 'Información y contenido' },
  { key: 'review', number: '03', title: 'Revisar', copy: 'Ficha y vista previa' },
  { key: 'publish', number: '04', title: 'Preparar', copy: 'Recursos del producto' },
];
