// src/lib/payment/transaction/managers/retry.manager.ts
import { Transaction, TransactionStatus, RetryPolicy } from '../types';
import { TransactionStore } from '../store/transaction.store';
import { RetryQueue } from '../recovery/queue/retry.queue';

export class RetryManager {
  constructor(
    private store: TransactionStore,
    private retryQueue: RetryQueue,
    private retryPolicy: RetryPolicy
  ) {}

  getMaxRetries(): number {
    return this.retryPolicy.maxAttempts;
  }

  async scheduleRetry(transaction: Transaction): Promise<Transaction> {
    const retryCount = transaction.retryCount + 1;
    const delay = this.calculateDelay(retryCount);

    const updatedTransaction = {
      ...transaction,
      retryCount,
      status: TransactionStatus.RECOVERY_PENDING,
      updatedAt: new Date()
    };

    await this.store.save(updatedTransaction);
    await this.retryQueue.enqueue(updatedTransaction.id, delay);

    return updatedTransaction;
  }

  private calculateDelay(retryCount: number): number {
    if (this.retryPolicy.backoffType === 'fixed') {
      return this.retryPolicy.initialDelay;
    }

    // Exponential backoff with jitter
    const exponentialDelay = this.retryPolicy.initialDelay * Math.pow(2, retryCount - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.min(exponentialDelay + jitter, this.retryPolicy.maxDelay);
  }
}