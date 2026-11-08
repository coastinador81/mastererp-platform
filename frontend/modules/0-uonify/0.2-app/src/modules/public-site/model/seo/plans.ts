/**
 * Suscripción de lanzamiento para los datos estructurados y llms.txt
 * (D-WEB-PUBLICA-20261022, D-PAGO-AL-ENTRAR-20261022, D-MODELO-NEGOCIO-20261022).
 * La web pública no llama a la API: estos importes se fijan al compilar. Son el ÚNICO
 * sitio donde se escriben los precios de la web; si admin cambia uno, hay que volver a
 * compilar la web pública (la página de Precios los lee de aquí).
 * - Una sola suscripción de Uonify; se paga al entrar, sin prueba gratis.
 * - La BASE es NETA (lo que ingresa Uonify) y el IVA se suma por país (Stripe Tax); no
 *   hay un precio único para la UE (decisión del dueño, 23-10-2026).
 * - En la web se MUESTRA con el IVA incluido; por defecto, el de España (21%). El precio
 *   final con el IVA del país se calcula antes de pagar. Nunca se enseña «+ IVA» solo.
 * - Las empresas con número de IVA válido pagan la base sin IVA (reverse charge).
 * - El importe anual es la base mensual × 12 (sin descuento por pago anual).
 * - Uonify no vende tokens ni créditos: la IA y la creación se pagan a Google, a sus
 *   precios de origen, desde la cuenta del cliente y sin recargo de Uonify.
 */

/** Lo que el JSON-LD y llms.txt necesitan de la suscripción (sin acoplar a billing). */
export interface PublicPlan {
  name: string;
  /** Importe mensual MOSTRADO (con el IVA de España incluido). */
  monthlyPrice: number | null;
  /** Importe anual MOSTRADO (con el IVA de España incluido). */
  yearlyPrice: number | null;
  description: string;
}

/** Base NETA mensual (lo que ingresa Uonify); la pagan las empresas con IVA válido. Única fuente. */
export const MONTHLY_NET_EUR = 9.90;
/** Base NETA anual (= mensual × 12, sin descuento). */
export const YEARLY_NET_EUR = 118.80;
/** Precio mensual MOSTRADO por defecto: base + IVA de España (21%). El IVA real depende del país (Stripe Tax). */
export const MONTHLY_PRICE_EUR = 11.98;
/** Precio anual MOSTRADO por defecto: base + IVA de España (21%). */
export const YEARLY_PRICE_EUR = 143.75;

export const PUBLIC_PLANS: readonly PublicPlan[] = [
  {
    name: 'Uonify',
    monthlyPrice: MONTHLY_PRICE_EUR,
    yearlyPrice: YEARLY_PRICE_EUR,
    description: 'Una suscripción única con todas las herramientas de Uonify y Uony, la IA de Uonify.',
  },
];

/** Importe con formato de España («118,80 €», «9,90 €», «0 €»). */
export function formatEuros(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2, useGrouping: true }).format(amount)} €`;
}

/** Resumen de la suscripción en una frase (oferta del JSON-LD y llms.txt). */
export function planSummary(plan: PublicPlan): string {
  if (plan.monthlyPrice === null) return `${plan.description} Precio a medida: habla con ventas en hola@uonify.com.`;
  const yearly = plan.yearlyPrice ?? plan.monthlyPrice * 12;
  return `${plan.description} ${formatEuros(plan.monthlyPrice)} al mes o ${formatEuros(yearly)} al año, con el IVA de España incluido; el IVA final depende de tu país y se muestra antes de pagar. La base sin IVA es ${formatEuros(MONTHLY_NET_EUR)} al mes (empresas con número de IVA válido). Se paga al entrar. La inteligencia artificial y la creación de contenido las pagas a Google, a sus precios y sin recargo de Uonify.`;
}
