/** Esta copia visible debe coincidir exactamente con product_materials_control_consent.py. */
export const MATERIAL_CONTROL_CONSENT = {
  upgradeReaders: {
    version: 'materials-upgrade-readers-2026-10-17-v1',
    paragraph: 'Uony puede ampliar la lectura de imágenes, documentos y archivos 3D de esta carpeta. Se conservan los datos confirmados; solo se analizan las partes nuevas. Esta ampliación dispone de un nuevo bloque de hasta 200 llamadas y 1.000.000 de tokens; al alcanzarlo se pausará. El consumo se realiza en tu proyecto de Google.',
    action: 'Analizar archivos pendientes con Uony',
    sha256: '08c68e5c888f87d04fe1d894b3daeaff4d0a2a1df13064ce923b7d988cbaa156',
  },
  repairEvidence: {
    version: 'materials-repair-evidence-2026-10-17-v1',
    paragraph: 'Uony volverá a comprobar solo las partes con evidencia pendiente. Se conservan tus respuestas y el historial. Puede requerir nuevas llamadas de análisis en tu proyecto de Google, con consumo registrado y pausa al alcanzar el límite del bloque.',
    action: 'Resolver lectura pendiente con Uony',
    sha256: '261472692cbc2fab27ce0bf2d3a65f1d3623b70e2d531cd94bbfb6034c2ae2ab',
  },
} as const;

export type MaterialConsentControl = keyof typeof MATERIAL_CONTROL_CONSENT;
export const materialControlConsentText = (action: MaterialConsentControl) => {
  const copy = MATERIAL_CONTROL_CONSENT[action];
  return `${copy.paragraph}\n${copy.action}`;
};
