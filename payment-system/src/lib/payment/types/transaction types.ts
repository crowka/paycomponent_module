// src/lib/payment/types/transaction.types.ts
// Centralized location for all transaction-related types

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
  RECOVERY_PENDING = 'RECOVERY_PENDING',
  RECOVERY_IN_PROGRESS = 'RECOVERY_IN_PROGRESS'
}

export enum TransactionType {
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  CHARGEBACK = 'CHARGEBACK'
}

export interface TransactionError {
  code: string;
  message: string;
  recoverable: boolean;
  retryable: boolean;
  details?: Record<string, any>;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
  idempotencyKey: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  retryCount: number;
  error?: TransactionError;
}

// Export additional transaction-related types below as needed
export enum TransactionErrorCode {
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  INVALID_CARD = 'INVALID_CARD',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  IDEMPOTENCY_VIOLATION = 'IDEMPOTENCY_VIOLATION'
}

export class TransactionFailedError extends Error {
  constructor(
    public code: TransactionErrorCode,
    public recoverable: boolean,
    public retryable: boolean,
    public details?: Record<string, any>
  ) {
    super(`Transaction failed: ${code}`);
    this.name = 'TransactionFailedError';
  }
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffType: 'fixed' | 'exponential';
  initialDelay: number;
  maxDelay: number;
}

export interface RecoveryStrategy {
  type: 'immediate' | 'delayed' | 'manual';
  retryPolicy?: RetryPolicy;
  timeout?: number;
  requiresManualIntervention?: boolean;
}
