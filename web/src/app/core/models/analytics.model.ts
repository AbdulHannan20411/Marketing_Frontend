export interface KpiSummary {
  readonly messagesSent: number;
  readonly delivered: number;
  readonly read: number;
  readonly failed: number;
  readonly clickThroughRate: number;
  /** Percentage change against the previous equivalent period. */
  readonly messagesSentDelta: number;
  readonly deliveredDelta: number;
  readonly readDelta: number;
  readonly failedDelta: number;
  readonly clickThroughRateDelta: number;
}

export interface TrendPoint {
  readonly date: string;
  readonly sent: number;
  readonly delivered: number;
  readonly read: number;
}

export interface FunnelStage {
  readonly label: string;
  readonly value: number;
}

export interface ActivityEntry {
  readonly id: string;
  readonly actor: string;
  readonly actorInitials: string;
  readonly action: string;
  readonly subject: string;
  readonly occurredAt: string;
}

export interface DashboardSnapshot {
  readonly kpis: KpiSummary;
  readonly trend: readonly TrendPoint[];
  readonly funnel: readonly FunnelStage[];
  readonly activity: readonly ActivityEntry[];
}
