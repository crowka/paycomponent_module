// src/lib/payment/transaction/types/errors.ts
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