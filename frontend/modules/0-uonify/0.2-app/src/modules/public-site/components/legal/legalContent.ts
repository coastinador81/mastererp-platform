/** Textos de las páginas legales del prototipo (#view-privacidad, #view-terminos). */
export type LegalKey = 'privacidad' | 'terminos';

export interface LegalDocument {
  eyebrow: string;
  title: string;
  lead: string;
  sections: ReadonlyArray<{ heading: string; body: string }>;
}

export const LEGAL_DOCUMENTS: Record<LegalKey, LegalDocument> = {
  privacidad: {
    eyebrow: 'UONIFY · PRIVACIDAD',
    title: 'Tu información, bajo tu control.',
    lead: 'Consulta y gestiona tus preferencias de privacidad.',
    sections: [
      { heading: 'Preferencias', body: 'Si cambias las preferencias visuales, se conservan en el almacenamiento de sesión de esta pestaña. Puedes restablecerlas desde Preferencias o cerrar la pestaña.' },
      { heading: 'Contacto', body: 'Para consultas sobre privacidad y el tratamiento de tus datos, escríbenos a hola@uonify.com.' },
    ],
  },
  terminos: {
    eyebrow: 'UONIFY · CONDICIONES',
    title: 'Información sobre el acceso.',
    lead: 'Consulta las condiciones desde tu cuenta de Uonify.',
    sections: [
      { heading: 'Tus aceptaciones', body: 'Encontrarás los documentos aceptados, sus versiones y sus fechas en Configuración › Privacidad y legal.' },
      { heading: 'Contacto', body: 'Si tienes alguna duda sobre las condiciones del servicio, escríbenos a hola@uonify.com.' },
    ],
  },
};
