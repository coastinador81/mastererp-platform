import type { Collection } from '@/shared/mocks/db';
import type { StoredArticle } from './store';

/** Solo sustituye las frases antiguas; conserva artículos, ediciones y estadísticas. */
export function migratePricingCopy(articles: Collection<StoredArticle>): void {
  const replacements: [string, string][] = [
    ['contratar un plan anual puedes', 'contratar un plan de pago puedes'],
    ['Cuando contratas un plan anual,', 'Cuando contratas un plan mensual o anual,'],
  [
    "Planes anuales y el mes gratis",
    "Planes mensuales, anuales y el mes gratis"
  ],
  [
    "Todos los planes de pago de Uonify son anuales e incluyen un mes gratis: 13 meses por el precio de 12.",
    "Elige pago mensual o anual. Con el anual tienes 13 meses de servicio por el precio de 12."
  ],
  [
    "49 € al mes, con facturación anual.",
    "49 € al mes, con pago mensual o anual."
  ],
  [
    "129 € al mes, con facturación anual.",
    "129 € al mes, con pago mensual o anual."
  ],
  [
    "299 € al mes, con facturación anual.",
    "299 € al mes, con pago mensual o anual."
  ],
  [
    "Todos los planes de pago incluyen un mes gratis:",
    "Los planes con pago anual incluyen un mes gratis:"
  ],
  [
    "## Por qué solo hay planes anuales",
    "## Pago mensual o anual"
  ],
  [
    "Los planes de pago de Uonify se contratan por un año. Se cobran al contratar y, durante los primeros 14 días, puedes desistir y recuperar tu dinero.",
    "Con el pago mensual se cobra una mensualidad por adelantado y se renueva cada mes. Con el anual pagas 12 mensualidades por adelantado y disfrutas de 13 meses de servicio. Los precios no incluyen impuestos. Puedes cancelar la renovación en Configuración › Plan y facturación. Durante los primeros 14 días puedes solicitar el desistimiento, descontando los tokens de Uonify del plan que hayas gastado."
  ],
  [
    "Abre **Configuración › Plan**, elige el plan y confirma el pago. Antes de pagar verás el importe exacto.",
    "Abre **Configuración › Plan y facturación**, elige Mensual o Anual y después tu plan. Antes de pagar verás el importe exacto y la fecha de renovación. Los cambios de modalidad se aplican al terminar el periodo ya pagado."
  ]
];
  for (const article of articles.all()) {
    if (!['planes-anuales', 'conectar-chatgpt', 'desistimiento-14-dias'].includes(article.slug)) continue;
    const patch: Partial<StoredArticle> = {};
    for (const field of ['title', 'summary', 'body'] as const) {
      const value = replacements.reduce((text, [from, to]) => text.replaceAll(from, to), article[field]);
      if (value !== article[field]) patch[field] = value;
    }
    if (Object.keys(patch).length) articles.patch(article.id, patch);
  }
}
