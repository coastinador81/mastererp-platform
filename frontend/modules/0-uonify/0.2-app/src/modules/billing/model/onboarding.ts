import type { SubscriptionStateData } from '../components/SubscriptionState';

export type OnboardingInterval = 'monthly' | 'annual';
export interface OnboardingOffer {
  offer: { version: string; currency: string; monthlyCents: number; annualCents: number; trialDays: number; reminderDays: number; taxIncluded: false; cardRequired: true };
  selection: { interval: OnboardingInterval; offerVersion: string } | null;
  checkoutReady: boolean;
  embeddedReady?: boolean;
  taxRatePercent?: number;
  taxScope?: string;
  subscription?: SubscriptionStateData | null;
  checkoutInterval?: OnboardingInterval | null;
  checkoutMode?: 'hosted' | 'embedded' | null;
  trialUsed?: boolean;
  access?: { status: string };
}
export interface EmbeddedCheckoutSession {
  checkoutAttemptId?: string;
  clientSecret: string;
  publishableKey: string;
  summary: { currency: 'EUR'; interval: OnboardingInterval; baseCents: number; taxCents: number; totalCents: number; dueTodayCents: number; trialDays: number; reminderDays: number; taxScope: string };
}
export interface CheckoutStatus {
  subscription: SubscriptionStateData | null;
  access: { status: string; basis?: string; endsAt?: string };
  checkoutStatus?: 'creating' | 'open' | 'complete' | 'expired' | null;
}
export const onboardingMoney = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
