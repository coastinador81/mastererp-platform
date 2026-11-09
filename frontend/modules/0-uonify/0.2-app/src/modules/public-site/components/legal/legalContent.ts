import privacidadMd from './privacidad.md?raw';
import cookiesMd from './cookies.md?raw';
import avisoLegalMd from './aviso-legal.md?raw';
import condicionesUso1 from './condiciones-uso-1.md?raw';
import condicionesUso2 from './condiciones-uso-2.md?raw';
import usoAceptableMd from './uso-aceptable.md?raw';
import estudioMd from './estudio.md?raw';
import pagoMd from './pago.md?raw';
import dpaMd from './dpa.md?raw';
import propiedadIntelectualMd from './propiedad-intelectual.md?raw';
import { fillLegal } from './legalData';
import { tocFromMarkdown, type TocItem } from './LegalMarkdown';

/** Centro legal de Uonify. Los textos son la copia fiel de Legal (platform/docs/legal),
 *  con los datos rellenados desde legalData.ts. Se presentan como pestañas: /terminos
 *  reúne todos los documentos del contrato (paneles con ancla, funcionan sin JS) y
 *  /privacidad es la pestaña de Privacidad en su propia página. La barra de pestañas es
 *  la misma en las dos páginas públicas (las únicas que la puerta sirve sin contraseña). */
export type LegalPageKey = 'terminos' | 'privacidad';
export type LegalTabId =
  | 'terminos' | 'aviso-legal' | 'privacidad' | 'cookies'
  | 'uso-aceptable' | 'pago' | 'estudio' | 'dpa' | 'propiedad-intelectual';

export interface LegalTab {
  id: LegalTabId;
  label: string;
  /** Privacidad vive en su propia página; el resto son paneles de /terminos. */
  page: LegalPageKey;
}

export const LEGAL_TABS: readonly LegalTab[] = [
  { id: 'terminos', label: 'Términos y condiciones', page: 'terminos' },
  { id: 'aviso-legal', label: 'Aviso legal', page: 'terminos' },
  { id: 'privacidad', label: 'Privacidad', page: 'privacidad' },
  { id: 'cookies', label: 'Cookies', page: 'terminos' },
  { id: 'uso-aceptable', label: 'Uso aceptable', page: 'terminos' },
  { id: 'pago', label: 'Pago y reembolsos', page: 'terminos' },
  { id: 'estudio', label: 'Estudio e IA', page: 'terminos' },
  { id: 'dpa', label: 'Tratamiento de datos', page: 'terminos' },
  { id: 'propiedad-intelectual', label: 'Propiedad intelectual', page: 'terminos' },
];

export interface LegalPanel {
  id: LegalTabId;
  title: string;
  body: string;
  toc: TocItem[];
}

/** Deja la línea «Versión en vigor…» como su propio párrafo. */
function fixPreamble(md: string): string {
  return md.replace(/(Versión en vigor desde el \{\{FECHA_VIGOR\}\})[ \t]*\n/, '$1.\n\n');
}

function panel(id: LegalTabId, title: string, md: string): LegalPanel {
  const body = fillLegal(fixPreamble(md));
  // Las anclas de los apartados se namespacean con el id del panel (sin colisiones).
  return { id, title, body, toc: tocFromMarkdown(body, id) };
}

/** Paneles de /terminos (todas las pestañas salvo Privacidad). */
export const TERMINOS_PANELS: readonly LegalPanel[] = [
  panel('terminos', 'Términos y condiciones', `${condicionesUso1}\n${condicionesUso2}`),
  panel('aviso-legal', 'Aviso legal', avisoLegalMd),
  panel('cookies', 'Política de cookies', cookiesMd),
  panel('uso-aceptable', 'Política de uso aceptable', usoAceptableMd),
  panel('pago', 'Condiciones de suscripción, pago y reembolsos', pagoMd),
  panel('estudio', 'Condiciones del Estudio y del contenido creado con IA', estudioMd),
  panel('dpa', 'Acuerdo de tratamiento de datos', dpaMd),
  panel('propiedad-intelectual', 'Política de propiedad intelectual y de denuncias', propiedadIntelectualMd),
];

/** Contenido de la página de Privacidad (su propia pestaña). */
export const PRIVACY_PANEL: LegalPanel = panel('privacidad', 'Política de privacidad', privacidadMd);

export const PAGE_META: Record<LegalPageKey, { eyebrow: string; title: string; lead: string }> = {
  terminos: {
    eyebrow: 'UONIFY · CONDICIONES',
    title: 'Aviso legal y condiciones.',
    lead: 'El centro legal de Uonify: el aviso legal, las condiciones de uso y los documentos que forman el contrato, cada uno en su pestaña.',
  },
  privacidad: {
    eyebrow: 'UONIFY · PRIVACIDAD',
    title: 'Tu información, bajo tu control.',
    lead: 'La política de privacidad completa de Uonify. Desde las pestañas llegas al resto de textos legales.',
  },
};
