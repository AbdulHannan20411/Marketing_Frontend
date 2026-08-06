import type { TenantPlan, TenantStatus } from './platform.model';

/**
 * An Admin account as seen by the Super Admin console.
 *
 * `id` identifies the *Admin account*, not a tenant. The backend maps it to a
 * tenant only after authorising the caller as SuperAdmin — the client never
 * handles a TenantId. See `scope.interceptor.ts`.
 */
export interface AdminAccount {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly email: string;
  readonly organisation: string;
  readonly plan: TenantPlan;
  readonly status: TenantStatus;
  readonly employeeCount: number;
  readonly contactCount: number;
  readonly campaignCount: number;
  readonly leadCount: number;
  readonly customerCount: number;
  readonly messagesThisMonth: number;
  readonly lastActiveAt: string;
  readonly createdAt: string;
}

/** Aggregated figures across every Admin on the platform. */
export interface PlatformOverview {
  readonly totalAdmins: number;
  readonly activeAdmins: number;
  readonly totalEmployees: number;
  readonly totalCampaigns: number;
  readonly totalLeads: number;
  readonly totalCustomers: number;
  readonly totalContacts: number;
  readonly totalMessagesThisMonth: number;
  readonly messagesDelta: number;
  readonly customersDelta: number;
  readonly leadsDelta: number;
  readonly campaignsDelta: number;
  readonly trend: readonly PlatformTrendPoint[];
  readonly planBreakdown: readonly PlanBreakdown[];
  readonly topAdmins: readonly AdminLeaderboardRow[];
}

export interface PlatformTrendPoint {
  readonly date: string;
  readonly messages: number;
  readonly customers: number;
}

export interface PlanBreakdown {
  readonly plan: TenantPlan;
  readonly adminCount: number;
  readonly monthlyRevenue: number;
}

export interface AdminLeaderboardRow {
  readonly adminId: string;
  readonly name: string;
  readonly organisation: string;
  readonly messagesThisMonth: number;
  readonly deliveryRate: number;
}
