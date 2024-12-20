// src/lib/payment/customer/types.ts
export interface CustomerProfile {
  id: string;
  externalId?: string;
  email: string;
  name?: string;
  defaultCurrency: string;
  defaultPaymentMethodId?: string;
  riskLevel: RiskLevel;
  metadata: Record<string, any>;
  preferences: CustomerPreferences;
  limits: SpendingLimits;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

export enum CustomerStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  BLOCKED = 'blocked'
}

export interface CustomerPreferences {
  communicationChannel: 'email' | 'sms' | 'push';
  defaultPaymentType?: PaymentMethodType;
  savePaymentMethods: boolean;
  autoPayEnabled: boolean;
}

export interface SpendingLimits {
  daily?: number;
  weekly?: number;
  monthly?: number;
  perTransaction?: number;
  currency: string;
}