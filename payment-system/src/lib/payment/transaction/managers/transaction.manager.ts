// src/lib/payment/transaction/managers/transaction.manager.ts
import { v4 as uuidv4 } from 'uuid';
import { 
  Transaction,
  TransactionStatus,
  TransactionType,
  TransactionError,
  TransactionFailedError
} from '../types';
import { TransactionStore } from '../store/transaction.store';
import { IdempotencyManager } from '../utils/idempotency';
import { RetryManager } from './retry.manager';
import { RecoveryManager } from './recovery.manager';

export class TransactionManager {
  constructor(
    private store: TransactionStore,
    private idempotencyManager: IdempotencyManager,
    private retryManager: RetryManager,
    private recoveryManager: RecoveryManager
  ) {}

  async beginTransaction(
    type: TransactionType,
    data: {
      amount: number;
      currency: string;
      customerId: string;
      paymentMethodId: string;
      idempotencyKey: string;
      metadata?: Record<string, any>;
    }
  ): Promise<Transaction> {
    // Check idempotency
    await this.idempotencyManager.checkAndLock(data.idempotencyKey);

    const transaction: Transaction = {
      id: uuidv4(),
      type,
      status: TransactionStatus.PENDING,
      ...data,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.store.save(transaction);
    return transaction;
  }

  async updateTransactionStatus(
    transactionId: string,
    status: TransactionStatus,
    error?: TransactionError
  ): Promise<Transaction> {
    const transaction = await this.store.get(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    const updatedTransaction = {
      ...transaction,
      status,
      error,
      updatedAt: new Date(),
      ...(status === TransactionStatus.COMPLETED && { completedAt: new Date() }),
      ...(status === TransactionStatus.FAILED && { failedAt: new Date() })
    };

    await this.store.save(updatedTransaction);
    return updatedTransaction;
  }

  async handleTransactionError(
    transactionId: string,
    error: TransactionFailedError
  ): Promise<Transaction> {
    const transaction = await this.store.get(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (error.retryable && transaction.retryCount < this.retryManager.getMaxRetries()) {
      return this.retryManager.scheduleRetry(transaction);
    }

    if (error.recoverable) {
      return this.recoveryManager.initiateRecovery(transaction, error);
    }

    return this.updateTransactionStatus(
      transactionId,
      TransactionStatus.FAILED,
      {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        retryable: error.retryable,
        details: error.details
      }
    );
  }

  async rollbackTransaction(transactionId: string): Promise<Transaction> {
    const transaction = await this.store.get(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    // Implement rollback logic based on transaction type
    switch (transaction.type) {
      case TransactionType.PAYMENT:
        // Implement payment rollback
        break;
      case TransactionType.REFUND:
        // Implement refund rollback
        break;
      default:
        throw new Error(`Unsupported transaction type: ${transaction.type}`);
    }

    return this.updateTransactionStatus(
      transactionId,
      TransactionStatus.ROLLED_BACK
    );
  }

  async getTransaction(transactionId: string): Promise<Transaction | null> {
    return this.store.get(transactionId);
  }

  async listTransactions(
    customerId: string,
    options: {
      status?: TransactionStatus;
      type?: TransactionType;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    }
  ): Promise<Transaction[]> {
    return this.store.query(customerId, options);
  }
}