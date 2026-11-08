/**
 * Planes, cobros y tokens de Uonify: planes mensuales y anuales (el anual incluye meses adicionales),
 * pago, desistimiento de 14 días, facturas, recargas desde 20 €, «Apoya a Uonify» y el
 * muro de pago (<PaywallHost/>, que escucha los 402 del backend). Contrato:
 * docs/FRONTEND-FASE-2.md. Rutas simuladas: mocks/handlers.ts y mocks/accountHandlers.ts.
 */
import './styles/index.css';
import './components/icons';

// Contrato de la fase 2 (lo importan AppProviders, settings y auth)
export { PaywallHost } from './components/PaywallHost';
export { BillingSettingsSection } from './components/BillingSettingsSection';
export { usePlans } from './hooks/usePlans';
export { startCheckout, openRecharge, type CheckoutOutcome } from './flows/checkout';
export type { BillingPlan, BillingInterval, PlanId } from './model/plans';

export { BillingIntervalPicker } from './components/plans/BillingIntervalPicker';

// Saldo de tokens de Uonify para «Uso» (settings) y el compositor (workspace)
export { useBalance, useBillingConfig, useSubscription } from './hooks/useBilling';
export { tokensLabel } from './model/money';
export type { BillingBalance, BillingConfig, Subscription } from './model/types';

// ChatGPT conectado: el aviso de tokens no ofrece conectarlo otra vez
export { setChatGptConnected } from './flows/dialogs';

// Admin: precios de los planes y configuración de cobros (PUT /billing/plans/:id y /billing/config)
export { billingApi } from './api/billingApi';

// Desarrollo y pruebas (solo con la simulación MSW): provoca cada 402
export { triggerPaywall } from './dev/paywall';

export { WorkspaceAccessGate } from './components/WorkspaceAccessGate';

export { OnboardingSubscription } from './components/OnboardingSubscription';
