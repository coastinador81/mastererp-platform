import type { BillingInterval, PlanId } from './plans';

export type WorkspaceAccess =
  | { status: 'allowed'; basis?: 'trial' | 'paid'; endsAt?: string }
  | { status: 'onboarding_required' | 'subscription_required' }
  | { status: 'checkout_required'; planId: PlanId; interval: BillingInterval };
