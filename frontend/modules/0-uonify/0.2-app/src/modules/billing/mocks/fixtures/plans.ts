import type { BillingPlan } from '../../model/plans';
import type { BillingConfig } from '../../model/types';

// Decisión del dueño: planes mensuales y anuales, 1 mes gratis = 13 meses por el precio de 12.
// Los límites por plan se definirán más adelante: estos textos son editables desde admin.
// Tokens incluidos al mes (no se acumulan): valores de la propuesta de precios
// (5 / 15 / 40 € en Básico, Pro y Max), también editables desde admin.
export const PLANS: BillingPlan[] = [
  { id: 'free', name: 'Gratis', monthlyPrice: 0, monthsPerYear: 12, seats: 1, includedTokens: 0, description: 'Para conocer Uonify y preparar tus primeras fichas.', limits: '1 usuario · 500 productos · 1 canal' },
  { id: 'basic', name: 'Básico', monthlyPrice: 49, monthsPerYear: 13, seats: 2, includedTokens: 500, description: 'Para empezar a trabajar con tu catálogo y tus canales.', limits: '2 usuarios · 2.000 productos · 2 canales' },
  { id: 'pro', name: 'Pro', monthlyPrice: 129, monthsPerYear: 13, seats: 4, includedTokens: 1500, popular: true, description: 'Para equipos que revisan y coordinan operaciones a escala.', limits: '4 usuarios · 10.000 productos · 5 canales' },
  { id: 'max', name: 'Max', monthlyPrice: 299, monthsPerYear: 13, seats: 10, includedTokens: 4000, description: 'Para equipos grandes con varias marcas y canales.', limits: '10 usuarios · 50.000 productos · 10 canales' },
  { id: 'custom', name: 'Personalizado', monthlyPrice: null, monthsPerYear: 13, seats: null, includedTokens: null, description: 'Para múltiples marcas, equipos y requisitos propios.', limits: 'Capacidad, seguridad y soporte acordados', contactSales: true },
];

/** Configuración de cobros (PUT /billing/config la cambia desde admin). */
export const DEFAULT_CONFIG: BillingConfig = {
  currency: 'EUR',
  tokenPrice: 0.01,
  minRecharge: 20,
  maxRecharge: 5000,
  supportAmount: 9,
  vatRate: 0.21,
  termsVersion: '2026-09-27',
};
