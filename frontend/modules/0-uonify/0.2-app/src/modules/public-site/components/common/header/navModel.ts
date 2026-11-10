import { PATHS, type PublicViewKey } from '../../../model/views';

/** Página comercial del menú: su texto, su destino y la frase de cabecera de la propia página. */
export interface NavPage {
  view: PublicViewKey;
  to: string;
  label: string;
  /** Frase de la cabecera (h1) de esa página: se reutiliza, no se inventa. */
  hint: string;
}

/** Entrada de la fila: un enlace directo o un grupo que se despliega. */
export type NavEntry = { kind: 'link'; page: NavPage } | { kind: 'group'; key: string; label: string; pages: readonly NavPage[] };

const PAGE = {
  servicios: { view: 'producto', to: PATHS.productos, label: 'Servicios', hint: 'Tus productos. Un universo de posibilidades.' },
  puedes: { view: 'lo-que-puedes-hacer', to: PATHS.loQuePuedesHacer, label: 'Lo que puedes hacer', hint: 'Siempre se puede empezar desde cero.' },
  equipos: { view: 'para-empresas', to: PATHS.paraEmpresas, label: 'Para equipos y marcas', hint: 'Varias marcas, varios canales.' },
  funciona: { view: 'como-funciona', to: PATHS.comoFunciona, label: 'Cómo funciona', hint: 'Dilo como lo piensas. Uony se encarga del cómo.' },
  precios: { view: 'precios', to: PATHS.precios, label: 'Precios', hint: 'Un plan. Claro desde el principio.' },
  clientes: { view: 'clientes', to: PATHS.clientes, label: 'Clientes', hint: 'Marcas que trabajan con Uonify.' },
  sobre: { view: 'empresa', to: PATHS.sobreUonify, label: 'Sobre Uonify', hint: 'Lo que creas tiene muchas posibilidades.' },
  seguridad: { view: 'seguridad', to: PATHS.seguridad, label: 'Seguridad', hint: 'Tus cuentas son tu negocio. Las tratamos como tal.' },
  partners: { view: 'partners', to: PATHS.partners, label: 'Partners', hint: 'Partners autorizados de Uonify.' },
  novedades: { view: 'novedades', to: PATHS.novedades, label: 'Novedades', hint: 'Nuevas piezas. Más posibilidades.' },
} satisfies Record<string, NavPage>;

/**
 * Menú de la cabecera en una fila (elección del dueño, 10-11-2026: «La A», tras pedir «que se vea
 * bonito, profesional, como lo hace Google»): las 10 páginas comerciales en dos grupos que se
 * despliegan y tres enlaces directos.
 */
export const HEADER_ENTRIES: readonly NavEntry[] = [
  { kind: 'group', key: 'servicios', label: 'Servicios', pages: [PAGE.servicios, PAGE.puedes, PAGE.equipos] },
  { kind: 'link', page: PAGE.funciona },
  { kind: 'link', page: PAGE.precios },
  { kind: 'link', page: PAGE.clientes },
  { kind: 'group', key: 'empresa', label: 'Empresa', pages: [PAGE.sobre, PAGE.seguridad, PAGE.partners, PAGE.novedades] },
];

/** Si una entrada contiene la página actual (para marcarla en la fila). */
export const entryHas = (entry: NavEntry, current?: PublicViewKey) =>
  current !== undefined && (entry.kind === 'link' ? entry.page.view === current : entry.pages.some(page => page.view === current));
