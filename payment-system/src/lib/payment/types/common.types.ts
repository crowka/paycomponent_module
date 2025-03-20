// src/lib/payment/types/common.types.ts

import { Transaction, TransactionType, TransactionStatus, TransactionError } from './transaction.types';
export { Transaction, TransactionType, TransactionStatus, TransactionError };

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

