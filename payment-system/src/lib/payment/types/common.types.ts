// src/lib/payment/types/common.types.ts
export interface PaymentAmount {
  amount: number;
  currency: string;
}

export interface Customer {
  id: string;
  email: string;
  name?: string;
  metadata?: Record<string, any>;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account' | 'digital_wallet';
  details: Record<string, any>;
  isDefault: boolean;
  customerId: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: PaymentError;
  metadata?: Record<string, any>;
}

export interface PaymentError {
  code: string;
  message: string;
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

export enum TransactionType {
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  CHARGEBACK = 'CHARGEBACK'
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
  RECOVERY_PENDING = 'RECOVERY_PENDING',
  RECOVERY_IN_PROGRESS = 'RECOVERY_IN_PROGRESS'
}

export interface TransactionError {
  code: string;
  message: string;
  recoverable: boolean;
  retryable: boolean;
  details?: Record<string, any>;
}
