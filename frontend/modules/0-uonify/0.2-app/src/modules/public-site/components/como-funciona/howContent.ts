/** Las cinco etapas del recorrido de «Cómo funciona» (como-funciona.js). */
export type HowStepKey = 'ask' | 'connect' | 'coordinate' | 'review' | 'publish';

export interface HowStep {
  overline: string;
  state: string;
  number: string;
  title: string;
  description: string;
  example: string;
  context: readonly string[];
}

export const HOW_STEPS: Record<HowStepKey, HowStep> = {
  ask: {
    overline: '01 · TU PETICIÓN',
    state: 'Entendida',
    number: '01',
    title: 'Empieza por el resultado que buscas.',
    description: 'No necesitas aprender dónde está cada función. Explica el objetivo y añade el contexto que quieras conservar.',
    example: 'Dime qué producto quieres publicar y dónde tienes sus archivos.',
    context: ['Por voz o por escrito', 'Un mismo hilo'],
  },
  connect: {
    overline: '02 · CONTEXTO DISPONIBLE',
    state: 'Permisos confirmados',
    number: '02',
    title: 'Reúne solo lo que este trabajo necesita.',
    description: 'Tus fuentes, cuentas y canales aportan contexto con un alcance visible y definido por ti.',
    example: 'Primero conecta Amazon. Después, elige en Google Drive los archivos del producto que quieras usar.',
    context: ['Amazon Seller Central', 'Google Drive', 'Permisos visibles'],
  },
  coordinate: {
    overline: '03 · TRABAJO COORDINADO',
    state: '4 etapas de preparación',
    number: '03',
    title: 'Cada herramienta aporta su especialidad.',
    description: 'Uonify reparte el trabajo, mantiene el contexto entre tareas y reúne los resultados en una misma vista.',
    example: 'Preparo los datos, las imágenes, el contenido A+ y el vídeo en la misma ficha de Producto.',
    context: ['Datos', 'Imágenes', 'Contenido A+', 'Vídeo'],
  },
  review: {
    overline: '04 · DECISIONES PENDIENTES',
    state: 'Vista previa disponible',
    number: '04',
    title: 'Tu atención va donde aporta criterio.',
    description: 'Los casos resueltos avanzan. Las dudas, diferencias y propuestas se separan para que puedas compararlas.',
    example: 'Abre la vista previa para revisar la ficha completa. Puedes pedirme cambios o abrir el módulo de Producto.',
    context: ['Vista previa en pop-up', 'Mismo borrador', 'Aprobación explícita'],
  },
  publish: {
    overline: '05 · RESULTADO PREPARADO',
    state: 'Listo para aprobar',
    number: '05',
    title: 'Una base común, adaptada a cada destino.',
    description: 'La información validada adopta la forma que necesita cada canal sin perder su ficha maestra.',
    example: 'Tras tu aprobación, el recorrido termina con la confirmación y el enlace del producto que devuelva Amazon.',
    context: ['Aprobar y publicar', 'Confirmación', 'Enlace al producto'],
  },
};

export const HOW_TABS: ReadonlyArray<{ key: HowStepKey; number: string; title: string; copy: string }> = [
  { key: 'ask', number: '01', title: 'Pide', copy: 'Con tus palabras' },
  { key: 'connect', number: '02', title: 'Conecta', copy: 'Contexto y cuentas' },
  { key: 'coordinate', number: '03', title: 'Coordina', copy: 'Herramientas y tareas' },
  { key: 'review', number: '04', title: 'Revisa', copy: 'Control humano' },
  { key: 'publish', number: '05', title: 'Publica', copy: 'Cada destino' },
];

/** Avisos de las demostraciones (Uony abriría la diferencia y sus opciones). */
export const HOW_TOASTS = {
  review: 'Uonify abriría la diferencia, su fuente y las opciones disponibles para decidir con contexto.',
  routeTitle: 'El recorrido conserva el contexto.',
  routeCopy: 'Petición, fuentes, herramientas participantes, cambios, aprobaciones y destinos permanecen vinculados al resultado.',
} as const;
