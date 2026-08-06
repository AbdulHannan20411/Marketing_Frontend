import type { FeatureModule } from './permission.model';

export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'suspended' | 'cancelled';
export type SupportLevel = 'community' | 'email' | 'priority' | 'dedicated';

/**
 * Every countable allowance a plan grants. `null` means unlimited — checks must
 * treat it as "no ceiling" rather than coercing it to zero.
 */
export interface PlanLimits {
  readonly maxEmployees: number | null;
  readonly maxContacts: number | null;
  readonly maxCampaigns: number | null;
  readonly maxWhatsAppAccounts: number | null;
  readonly maxEmailAccounts: number | null;
  readonly maxSocialAccounts: number | null;
  readonly maxApiCallsPerMonth: number | null;
  readonly maxStorageMb: number | null;
  readonly dailyMessageLimit: number | null;
  readonly monthlyMessageLimit: number | null;
}

export type PlanModules = Readonly<Record<FeatureModule, boolean>>;

export type PlanStatus = 'active' | 'inactive' | 'archived';

export interface SubscriptionPlan {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly monthlyPrice: number;
  readonly yearlyPrice: number;
  readonly currency: string;
  readonly trialDays: number;
  /** Renewal period in months: 1 for monthly billing, 12 for yearly. */
  readonly renewalPeriodMonths: number;
  readonly discountPercent: number;
  readonly isPromotional: boolean;
  readonly isMostPopular: boolean;
  readonly isRecommended: boolean;
  readonly status: PlanStatus;
  readonly supportLevel: SupportLevel;
  readonly modules: PlanModules;
  readonly limits: PlanLimits;
  readonly highlights: readonly string[];
  readonly sortOrder: number;
  readonly updatedAt: string;
}

export interface Subscription {
  readonly planId: string;
  readonly planName: string;
  readonly status: SubscriptionStatus;
  readonly billingCycle: BillingCycle;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly nextRenewalAt: string | null;
  readonly expiresAt: string;
  readonly autoRenew: boolean;
  readonly trialEndsAt: string | null;
  readonly seatsPurchased: number;
  readonly amount: number;
  readonly currency: string;
}

export type UsageMetricKey =
  | 'employees'
  | 'contacts'
  | 'campaigns'
  | 'whatsappAccounts'
  | 'emailAccounts'
  | 'socialAccounts'
  | 'apiCalls'
  | 'storage'
  | 'messagesDaily'
  | 'messagesMonthly';

export interface UsageMetric {
  readonly key: UsageMetricKey;
  readonly label: string;
  readonly used: number;
  /** `null` when the plan grants an unlimited allowance. */
  readonly limit: number | null;
  readonly unit: string;
}

export interface SubscriptionSnapshot {
  readonly subscription: Subscription;
  readonly plan: SubscriptionPlan;
  readonly usage: readonly UsageMetric[];
}

/* ------------------------------------------------------------------ *
 * Billing
 * ------------------------------------------------------------------ */
export type InvoiceStatus = 'paid' | 'due' | 'overdue' | 'refunded' | 'void';
export type PaymentStatus = 'succeeded' | 'failed' | 'pending' | 'refunded';
export type PaymentMethodKind = 'card' | 'bank_transfer' | 'paypal';

export interface Invoice {
  readonly id: string;
  readonly number: string;
  readonly planName: string;
  readonly billingCycle: BillingCycle;
  readonly amount: number;
  readonly tax: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly issuedAt: string;
  readonly dueAt: string;
  readonly paidAt: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly downloadUrl: string;
}

export interface Payment {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly method: PaymentMethodKind;
  readonly cardBrand: string | null;
  readonly cardLast4: string | null;
  readonly processedAt: string;
  readonly failureReason: string | null;
}

export interface RenewalRecord {
  readonly id: string;
  readonly planName: string;
  readonly billingCycle: BillingCycle;
  readonly amount: number;
  readonly currency: string;
  readonly renewedAt: string;
  readonly periodEnd: string;
  readonly automatic: boolean;
}

export interface BillingHistory {
  readonly invoices: readonly Invoice[];
  readonly payments: readonly Payment[];
  readonly renewals: readonly RenewalRecord[];
}
