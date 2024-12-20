// src/lib/payment/compliance/types.ts
export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  validator: (data: any) => Promise<ComplianceValidation>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: ComplianceCategory;
  enabled: boolean;
}

export interface ComplianceValidation {
  passed: boolean;
  violations: ComplianceViolation[];
}

export interface ComplianceViolation {
  ruleId: string;
  message: string;
  data: any;
  timestamp: Date;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  timestamp: Date;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
}

export enum ComplianceCategory {
  KYC = 'kyc',
  AML = 'aml',
  DATA_PROTECTION = 'data_protection',
  TRANSACTION_LIMITS = 'transaction_limits',
  REPORTING = 'reporting'
}