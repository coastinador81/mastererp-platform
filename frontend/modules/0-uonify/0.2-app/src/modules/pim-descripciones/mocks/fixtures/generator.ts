/**
 * Contenido que devuelve la simulación de Uony (POST /ai-descriptions): una
 * descripción en HTML, keywords para Amazon y viñetas de hasta 250 caracteres,
 * construidas con los datos que envía la ficha (nombre, categoría,
 * características y viñetas existentes).
 */
export interface ProductInfo {
  nombre_producto?: unknown;
  descripcion?: unknown;
  caracteristicas?: unknown;
  categoria?: unknown;
  existing_bullets?: unknown;
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lowerFirst = (text: string) => (text ? text[0].toLowerCase() + text.slice(1) : text);
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(clean).filter(Boolean) : []);
// Una categoría técnica de Amazon (TOY_FIGURE) no se lee como texto en español: se omite.
const categoryText = (value: unknown) => (/^[A-Z0-9_]+$/.test(clean(value)) ? '' : clean(value).toLowerCase());

function facts(info: ProductInfo): string[] {
  // Primero las características «clave: valor» (atributos) y después las viñetas, sin repetir.
  const all = [...list(info.caracteristicas), ...list(info.existing_bullets)];
  return all.filter((item, index) => all.indexOf(item) === index).slice(0, 5);
}

export function generateDescription(info: ProductInfo): string {
  const name = clean(info.nombre_producto) || 'Este producto';
  const intro = `<p><strong>${escape(name)}</strong> está pensado para el día a día: fácil de usar, resistente y con un acabado cuidado en cada detalle.</p>`;
  const points = facts(info);
  const items = (points.length ? points : [
    'Materiales seleccionados para un uso prolongado',
    'Diseño práctico que se adapta a cualquier espacio',
    'Listo para usar nada más sacarlo de la caja',
  ]).map(point => `<li>${escape(point)}</li>`).join('');
  const closing = '<p>Un regalo acertado y una compra que se nota desde el primer uso. Si tienes cualquier duda, nuestro equipo de atención al cliente te ayuda.</p>';
  return `${intro}\n<ul>${items}</ul>\n${closing}`;
}

export function generateKeywords(info: ProductInfo): string {
  const stop = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'para', 'por', 'en', 'un', 'una', 'a', 'o', 'al', 'sin', 'su', 'sus']);
  // De las características, solo lo que se busca: valores («material: Roble» → Roble) y frases cortas.
  const terms = facts(info).map(fact => {
    const pair = /^([^:]{2,40}):\s*(.*)$/.exec(fact);
    if (pair) return /^[A-ZÁÉÍÓÚÑ\s]+$/.test(pair[1]) ? '' : pair[2];
    return fact.length <= 40 ? fact : '';
  });
  const source = [clean(info.nombre_producto), categoryText(info.categoria), ...terms].join(' ');
  const words = source
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stop.has(word));
  const extra = ['regalo', 'calidad', 'resistente', 'original', 'practico'];
  const unique = [...new Set([...words, ...extra])];
  // Amazon admite 250 bytes en generic_keyword: palabras separadas por espacios, sin repetir.
  let result = '';
  for (const word of unique) {
    const next = result ? `${result} ${word}` : word;
    if (new TextEncoder().encode(next).length > 250) break;
    result = next;
  }
  return result;
}

const BULLET_TEMPLATES: Array<(name: string, fact: string) => string> = [
  (name, fact) => `CALIDAD QUE SE NOTA: ${name} está fabricado con materiales seleccionados${fact ? ` (${lowerFirst(fact)})` : ''} para durar y mantener su aspecto con el uso diario.`,
  name => `FÁCIL DE USAR: ${name} está listo nada más sacarlo de la caja; sin montajes complicados ni herramientas, para disfrutarlo desde el primer minuto.`,
  (name, fact) => `DISEÑO PENSADO PARA TI: líneas limpias y un tamaño práctico${fact ? `; ${lowerFirst(fact)}` : ''}. ${name} encaja en casa, en la oficina o de viaje.`,
  name => `EL REGALO PERFECTO: ${name} llega en un packaging cuidado, listo para regalar en cumpleaños, aniversarios o cualquier ocasión especial.`,
  name => `COMPRA SIN PREOCUPACIONES: ${name} cuenta con garantía y con un equipo de atención al cliente que responde en español a cualquier duda.`,
  name => `CONTENIDO DEL PAQUETE: 1 × ${name} y guía de uso rápida en español. Revisa las medidas y características antes de comprar.`,
];

export function generateBullet(info: ProductInfo, index: number): string {
  const name = clean(info.nombre_producto) || 'este producto';
  const fact = facts(info).find(item => item.includes(':'))?.replace(/^([^:]+):\s*/, '$1 ') ?? '';
  const template = BULLET_TEMPLATES[index] ?? BULLET_TEMPLATES[BULLET_TEMPLATES.length - 1];
  const bullet = template(name, fact);
  return bullet.length > 250 ? `${bullet.slice(0, 249).trimEnd()}…` : bullet;
}
