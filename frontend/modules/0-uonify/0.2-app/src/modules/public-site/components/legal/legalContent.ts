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

/** Textos de las páginas legales públicas (#view-privacidad, #view-terminos).
 *  El cuerpo es la copia fiel de los textos de Legal (platform/docs/legal), con los
 *  datos de la empresa rellenados desde legalData.ts. /terminos reúne, en una sola
 *  página con índice, el Aviso legal, las Condiciones de uso y los documentos que las
 *  forman (cada uno como apartado con su ancla). */
export type LegalKey = 'privacidad' | 'terminos';

export interface LegalDocument {
  eyebrow: string;
  title: string;
  lead: string;
  body: string;
  toc: TocItem[];
}

/** Deja la línea «Versión en vigor…» como su propio párrafo (no la une con la de idioma). */
function fixPreamble(md: string): string {
  return md.replace(/(Versión en vigor desde el \{\{FECHA_VIGOR\}\})[ \t]*\n/, '$1.\n\n');
}

/** Documento referenciado: su título pasa a nivel 2 y sus apartados internos bajan un nivel,
 *  para que en el índice de la página aparezca solo el título del documento. */
function asSubDoc(md: string): string {
  return fixPreamble(md)
    .split('\n')
    .map(line => (/^#{1,6} /.test(line) ? `#${line}` : line))
    .join('\n');
}

/** Documento principal: quita su «# Título» y lo pinta bajo un apartado de nivel 2. */
function asMainDoc(title: string, md: string): string {
  return `## ${title}\n\n${fixPreamble(md).replace(/^# .+\n/m, '')}`;
}

const privacidad = fillLegal(`${fixPreamble(privacidadMd)}\n\n${asSubDoc(cookiesMd)}`);

const terminos = fillLegal(
  [
    fixPreamble(avisoLegalMd),
    asMainDoc('Condiciones de uso', `${condicionesUso1}\n${condicionesUso2}`),
    asSubDoc(usoAceptableMd),
    asSubDoc(estudioMd),
    asSubDoc(pagoMd),
    asSubDoc(dpaMd),
    asSubDoc(propiedadIntelectualMd),
  ].join('\n\n'),
);

export const LEGAL_DOCUMENTS: Record<LegalKey, LegalDocument> = {
  privacidad: {
    eyebrow: 'UONIFY · PRIVACIDAD',
    title: 'Tu información, bajo tu control.',
    lead: 'La política de privacidad completa de Uonify, con la Política de cookies: qué datos tratamos, para qué, con quién los compartimos y cómo ejerces tus derechos.',
    body: privacidad,
    toc: tocFromMarkdown(privacidad),
  },
  terminos: {
    eyebrow: 'UONIFY · CONDICIONES',
    title: 'Aviso legal y condiciones.',
    lead: 'El aviso legal de Uonify, las Condiciones de uso completas y los documentos que forman el contrato: uso aceptable, Estudio e IA, pago y reembolsos, tratamiento de datos y propiedad intelectual.',
    body: terminos,
    toc: tocFromMarkdown(terminos),
  },
};
