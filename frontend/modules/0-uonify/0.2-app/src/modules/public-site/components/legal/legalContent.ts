import privacidadMd from './privacidad.md?raw';
import condicionesMd from './condiciones.md?raw';
import { fillLegal } from './legalData';
import { tocFromMarkdown, type TocItem } from './LegalMarkdown';

/** Textos de las páginas legales públicas (#view-privacidad, #view-terminos).
 *  El cuerpo es la copia fiel de los textos de Legal (platform/docs/legal), con los
 *  datos de la empresa rellenados desde legalData.ts. */
export type LegalKey = 'privacidad' | 'terminos';

export interface LegalDocument {
  eyebrow: string;
  title: string;
  lead: string;
  body: string;
  toc: TocItem[];
}

const privacidad = fillLegal(privacidadMd);
const condiciones = fillLegal(condicionesMd);

export const LEGAL_DOCUMENTS: Record<LegalKey, LegalDocument> = {
  privacidad: {
    eyebrow: 'UONIFY · PRIVACIDAD',
    title: 'Tu información, bajo tu control.',
    lead: 'La política de privacidad completa de Uonify: qué datos tratamos, para qué, con quién los compartimos y cómo ejerces tus derechos.',
    body: privacidad,
    toc: tocFromMarkdown(privacidad),
  },
  terminos: {
    eyebrow: 'UONIFY · CONDICIONES',
    title: 'Aviso legal y condiciones.',
    lead: 'El aviso legal de Uonify y las condiciones aplicables a los recursos adicionales de cada servicio.',
    body: condiciones,
    toc: tocFromMarkdown(condiciones),
  },
};
