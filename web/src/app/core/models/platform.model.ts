export type TenantPlan = 'starter' | 'growth' | 'scale' | 'enterprise';
export type TenantStatus = 'active' | 'trialing' | 'suspended';

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly ownerEmail: string;
  readonly plan: TenantPlan;
  readonly status: TenantStatus;
  readonly seats: number;
  readonly messagesThisMonth: number;
  readonly messageQuota: number;
  readonly createdAt: string;
}

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditLogEntry {
  readonly id: string;
  readonly actor: string;
  readonly actorInitials: string;
  readonly action: string;
  readonly target: string;
  readonly workspace: string;
  readonly ipAddress: string;
  readonly severity: AuditSeverity;
  readonly occurredAt: string;
}

export interface ServiceHealth {
  readonly name: string;
  readonly status: 'operational' | 'degraded' | 'outage';
  readonly uptimePercent: number;
  readonly latencyMs: number;
}

export interface QuotaUsage {
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly unit: string;
}

export interface SystemSnapshot {
  readonly services: readonly ServiceHealth[];
  readonly quotas: readonly QuotaUsage[];
  readonly throughput: readonly TrendSample[];
}

export interface TrendSample {
  readonly label: string;
  readonly value: number;
}
