// src/lib/payment/analytics/types.ts
export interface AnalyticsMetric {
  id: string;
  name: string;
  value: number;
  dimension: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface AnalyticsReport {
  id: string;
  type: ReportType;
  dateRange: DateRange;
  metrics: AnalyticsMetric[];
  summary: Record<string, number>;
  generatedAt: Date;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export enum ReportType {
  TRANSACTION_VOLUME = 'transaction_volume',
  REVENUE = 'revenue',
  PAYMENT_METHODS = 'payment_methods',
  CURRENCY_USAGE = 'currency_usage',
  RISK_ANALYSIS = 'risk_analysis',
  COMPLIANCE = 'compliance'
}
