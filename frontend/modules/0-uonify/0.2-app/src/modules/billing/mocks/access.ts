import { mockBillingAccount } from '@/modules/auth';
import { record } from '@/shared/mocks/db';
import type { WorkspaceAccess } from '../model/access';
import type { BillingInterval, PlanId } from '../model/plans';

const completed = record<Record<string, string>>('billing-onboarding-paid', () => ({}));

/** Solo un cobro confirmado de la cuenta satisface el checkout inicial. */
export function pendingCheckout(): WorkspaceAccess | null {
  const { email, profile } = mockBillingAccount();
  if (!email || !profile) return null;
  const planId = profile.desiredPlan;
  if (completed.get()[email] || planId === 'free' || planId === 'custom') return { status: 'allowed' };
  return { status: 'checkout_required', planId, interval: profile.billingInterval ?? 'monthly' };
}

export function confirmOnboardingPayment(planId: PlanId, interval: BillingInterval, invoiceId: string) {
  const email = mockBillingAccount().email;
  const pending = pendingCheckout();
  if (email && pending?.status === 'checkout_required' && pending.planId === planId && pending.interval === interval) {
    completed.update(all => ({ ...all, [email]: invoiceId }));
  }
}

export const resetAccessMocks = () => completed.set({});
