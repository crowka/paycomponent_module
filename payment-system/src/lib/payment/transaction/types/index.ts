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

export interface TransactionError {
  code: string;
  message: string;
  recoverable: boolean;
  retryable: boolean;
  details?: Record<string, any>;
}