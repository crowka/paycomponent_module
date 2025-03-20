// src/lib/payment/transaction/managers/retry.manager.ts

import { v4 as uuidv4 } from 'uuid';
import { 
  Transaction, 
  TransactionStatus, 
  TransactionType,
  TransactionErrorCode,
  TransactionError
} from '../../types/transaction.types';
import { TransactionStore } from '../store/transaction.store';
import { RetryQueue } from '../recovery/queue/retry.queue';
import { PaymentLogger } from '../../utils/logger';
import { EventEmitter } from '../../events/event.emitter';
import { errorHandler, ErrorCode } from '../../utils/error';
import { RecordLocker, LockLevel } from '../../utils/record-locker';

/**
 * Retry policy interface defining how retries should behave
 */
export interface RetryPolicy {
  maxAttempts: number;
  backoffType: 'fixed' | 'exponential';
  initialDelay: number;
  maxDelay: number;
  jitterFactor?: number;
}

/**
 * Options for initializing the RetryManager
 */
export interface RetryManagerOptions {
  retryPolicy?: Partial<RetryPolicy>;
  eventEmitter?: EventEmitter;
  recordLocker?: RecordLocker;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Manages retrying failed transactions with configurable policies,
 * backoff strategies, and error handling.
 */
export class RetryManager {
  private logger: PaymentLogger;
  private retryPolicy: RetryPolicy;
  private eventEmitter?: EventEmitter;
  private recordLocker?: RecordLocker;
  private lockTimeoutMs: number = 10000; // 10 seconds
  
  constructor(
    private store: TransactionStore,
    private retryQueue: RetryQueue,
    options: RetryManagerOptions = {}
  ) {
    this.logger = new PaymentLogger(options.logLevel || 'info', 'RetryManager');
    this.eventEmitter = options.eventEmitter;
    this.recordLocker = options.recordLocker;
    
    // Set up retry policy with defaults and any overrides
    this.retryPolicy = {
      maxAttempts: 3,
      backoffType: 'exponential',
      initialDelay: 1000, // 1 second
      maxDelay: 60000,    // 1 minute
      jitterFactor: 0.1,  // 10% jitter
      ...options.retryPolicy
    };
    
    // Subscribe to retry events from the queue
    this.retryQueue.on('retry', this.handleRetry.bind(this));
    
    this.logger.info('Retry manager initialized', {
      policy: this.retryPolicy
    });
  }

  /**
   * Get the maximum number of retry attempts configured
   */
  getMaxRetries(): number {
    return this.retryPolicy.maxAttempts;
  }

  /**
   * Schedule a transaction for retry
   * @param transaction The transaction to retry
   * @param error Optional error information
   */
  async scheduleRetry(
    transaction: Transaction,
    error?: TransactionError
  ): Promise<Transaction> {
    const operationId = uuidv4().slice(0, 8);
    let lockId: string | undefined;
    
    try {
      // Check if we've exceeded max retries
      if (transaction.retryCount >= this.retryPolicy.maxAttempts) {
        this.logger.warn(`[${operationId}] Max retry attempts reached for transaction ${transaction.id}`, {
          retryCount: transaction.retryCount,
          maxAttempts: this.retryPolicy.maxAttempts
        });
        
        // Mark as failed - we're not going to retry anymore
        return this.markAsFailed(transaction, error || {
          code: 'RETRY_LIMIT_EXCEEDED',
          message: `Maximum retry attempts (${this.retryPolicy.maxAttempts}) reached`,
          recoverable: false,
          retryable: false,
          details: {
            retryCount: transaction.retryCount,
            maxRetries: this.retryPolicy.maxAttempts
          }
        });
      }
      
      // Try to acquire lock if locker is available
      if (this.recordLocker) {
        try {
          lockId = await this.recordLocker.acquireLock(
            transaction.id,
            'transaction',
            { 
              waitTimeoutMs: this.lockTimeoutMs,
              lockLevel: LockLevel.EXCLUSIVE
            }
          );
          this.logger.debug(`[${operationId}] Acquired lock for transaction ${transaction.id}`);
        } catch (lockError) {
          this.logger.error(`[${operationId}] Failed to acquire lock for transaction ${transaction.id}`, { 
            error: lockError 
          });
          // Continue without lock in this case, but this is not optimal
        }
      }
      
      const retryCount = transaction.retryCount + 1;
      const delay = this.calculateDelay(retryCount);
      
      this.logger.info(`[${operationId}] Scheduling retry ${retryCount}/${this.retryPolicy.maxAttempts} for transaction ${transaction.id}`, {
        delay,
        status: transaction.status
      });
      
      // Update transaction with retry information
      const updatedTransaction = {
        ...transaction,
        retryCount,
        status: TransactionStatus.RECOVERY_PENDING,
        updatedAt: new Date(),
        metadata: {
          ...transaction.metadata,
          lastRetryAt: new Date(),
          nextRetryAt: new Date(Date.now() + delay),
          retryReason: error?.code || 'UNKNOWN_ERROR'
        }
      };
      
      // Store error information if provided
      if (error) {
        updatedTransaction.error = error;
      }
      
      // Save updated transaction
      await this.store.save(updatedTransaction);
      
      // Add to retry queue
      await this.retryQueue.enqueue(updatedTransaction.id, delay);
      
      // Emit retry scheduled event
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.retry_scheduled', {
          transactionId: transaction.id,
          retryCount,
          delay,
          errorCode: error?.code,
          scheduledAt: new Date(),
          nextRetryAt: new Date(Date.now() + delay)
        });
      }
      
      return updatedTransaction;
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to schedule retry for transaction ${transaction.id}`, { error });
      
      throw errorHandler.wrapError(
        error,
        'Failed to schedule transaction retry',
        ErrorCode.INTERNAL_ERROR,
        { transactionId: transaction.id }
      );
    } finally {
      // Release lock if acquired
      if (this.recordLocker && lockId) {
        try {
          await this.recordLocker.releaseLock(transaction.id, 'transaction', lockId);
          this.logger.debug(`[${operationId}] Released lock for transaction ${transaction.id}`);
        } catch (releaseError) {
          this.logger.error(`[${operationId}] Failed to release lock for transaction ${transaction.id}`, {
            error: releaseError
          });
        }
      }
    }
  }

  /**
   * Cancel a scheduled retry
   * @param transactionId The transaction ID to cancel retry for
   */
  async cancelRetry(transactionId: string): Promise<boolean> {
    try {
      // Dequeue from retry queue
      await this.retryQueue.dequeue(transactionId);
      
      // Get the transaction
      const transaction = await this.store.get(transactionId);
      if (!transaction) {
        return false;
      }
      
      // Only update if it's in a recovery pending state
      if (transaction.status === TransactionStatus.RECOVERY_PENDING) {
        const updatedTransaction = {
          ...transaction,
          status: TransactionStatus.FAILED,
          updatedAt: new Date(),
          failedAt: new Date(),
          metadata: {
            ...transaction.metadata,
            retryCancelled: true,
            cancelledAt: new Date()
          }
        };
        
        await this.store.save(updatedTransaction);
        
        // Emit event
        if (this.eventEmitter) {
          await this.eventEmitter.emit('transaction.retry_cancelled', {
            transactionId,
            retryCount: transaction.retryCount
          });
        }
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel retry for transaction ${transactionId}`, { error });
      return false;
    }
  }

  /**
   * Handle a retry event from the queue
   * @param transactionId The transaction ID to retry
   */
  private async handleRetry(transactionId: string): Promise<void> {
    const operationId = uuidv4().slice(0, 8);
    let lockId: string | undefined;
    
    try {
      this.logger.info(`[${operationId}] Processing retry for transaction ${transactionId}`);
      
      // Get transaction
      const transaction = await this.store.get(transactionId);
      if (!transaction) {
        this.logger.error(`[${operationId}] Transaction not found: ${transactionId}`);
        return;
      }
      
      // Verify transaction is still in recovery pending state
      if (transaction.status !== TransactionStatus.RECOVERY_PENDING) {
        this.logger.warn(`[${operationId}] Transaction ${transactionId} not in RECOVERY_PENDING state, skipping retry`, {
          currentStatus: transaction.status
        });
        return;
      }
      
      // Try to acquire lock if locker is available
      if (this.recordLocker) {
        try {
          lockId = await this.recordLocker.acquireLock(
            transaction.id,
            'transaction',
            { 
              waitTimeoutMs: this.lockTimeoutMs,
              lockLevel: LockLevel.EXCLUSIVE
            }
          );
          this.logger.debug(`[${operationId}] Acquired lock for transaction ${transaction.id}`);
        } catch (lockError) {
          this.logger.error(`[${operationId}] Failed to acquire lock for transaction ${transaction.id}`, { 
            error: lockError 
          });
          // Re-queue for later retry
          await this.retryQueue.enqueue(transactionId, 5000);
          return;
        }
      }
      
      // Update transaction to processing
      const processingTransaction = {
        ...transaction,
        status: TransactionStatus.PROCESSING,
        updatedAt: new Date(),
        metadata: {
          ...transaction.metadata,
          retryAttemptStarted: new Date()
        }
      };
      
      await this.store.save(processingTransaction);
      
      // Emit event for retry started
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.retry_started', {
          transactionId,
          retryCount: transaction.retryCount,
          timestamp: new Date()
        });
      }
      
      // Here we would typically delegate to a payment processor or service
      // For now, we'll simulate a decision based on retry count to demonstrate different outcomes
      
      // Call the appropriate service to process the retry
      // This is just a placeholder - in a real implementation you would:
      // 1. Get the transaction processor from a factory or dependency injection
      // 2. Call the appropriate method based on transaction type
      // 3. Handle the result appropriately
      
      // For demonstration purposes only:
      const success = Math.random() > 0.3; // 70% success rate for demo
      
      if (success) {
        // Transaction succeeded on retry
        await this.markAsCompleted(transaction);
      } else {
        // Failed again, check if we should retry
        if (transaction.retryCount < this.retryPolicy.maxAttempts) {
          // Schedule another retry
          await this.scheduleRetry(transaction, {
            code: 'RETRY_FAILED',
            message: 'Transaction retry attempt failed',
            recoverable: true,
            retryable: true,
            details: {
              retryCount: transaction.retryCount
            }
          });
        } else {
          // Max retries reached, mark as failed
          await this.markAsFailed(transaction, {
            code: 'MAX_RETRIES_EXCEEDED',
            message: `Failed after ${transaction.retryCount} retry attempts`,
            recoverable: false,
            retryable: false,
            details: {
              maxRetries: this.retryPolicy.maxAttempts,
              attemptsUsed: transaction.retryCount
            }
          });
        }
      }
    } catch (error) {
      this.logger.error(`[${operationId}] Error processing retry for transaction ${transactionId}`, { error });
      
      try {
        // Get transaction info for error context
        const transaction = await this.store.get(transactionId);
        
        if (transaction) {
          // Mark as failed with error info
          await this.markAsFailed(transaction, {
            code: 'RETRY_PROCESSING_ERROR',
            message: error.message || 'Error processing retry',
            recoverable: false,
            retryable: transaction.retryCount < this.retryPolicy.maxAttempts,
            details: {
              error: error.message,
              retryCount: transaction.retryCount
            }
          });
        }
      } catch (updateError) {
        this.logger.error(`[${operationId}] Failed to update transaction after retry error`, { error: updateError });
      }
    } finally {
      // Release lock if acquired
      if (this.recordLocker && lockId) {
        try {
          await this.recordLocker.releaseLock(transactionId, 'transaction', lockId);
          this.logger.debug(`[${operationId}] Released lock for transaction ${transactionId}`);
        } catch (releaseError) {
          this.logger.error(`[${operationId}] Failed to release lock for transaction ${transactionId}`, {
            error: releaseError
          });
        }
      }
    }
  }

  /**
   * Calculate delay for next retry using the configured policy
   * @param retryCount Current retry count
   */
  private calculateDelay(retryCount: number): number {
    const { backoffType, initialDelay, maxDelay, jitterFactor } = this.retryPolicy;
    
    // Calculate base delay according to backoff type
    let delay: number;
    
    if (backoffType === 'fixed') {
      delay = initialDelay;
    } else {
      // Exponential backoff: initialDelay * 2^(retryCount-1)
      delay = initialDelay * Math.pow(2, retryCount - 1);
    }
    
    // Apply jitter to prevent thundering herd problem
    if (jitterFactor) {
      const jitterAmount = delay * jitterFactor;
      delay = delay + (Math.random() * jitterAmount * 2 - jitterAmount);
    }
    
    // Ensure delay doesn't exceed maximum
    return Math.min(delay, maxDelay);
  }

  /**
   * Mark a transaction as completed
   * @param transaction The transaction to mark as completed
   */
  private async markAsCompleted(transaction: Transaction): Promise<Transaction> {
    const completedTransaction = {
      ...transaction,
      status: TransactionStatus.COMPLETED,
      updatedAt: new Date(),
      completedAt: new Date(),
      metadata: {
        ...transaction.metadata,
        completedAfterRetry: true,
        finalRetryCount: transaction.retryCount
      }
    };
    
    await this.store.save(completedTransaction);
    
    // Emit event
    if (this.eventEmitter) {
      await this.eventEmitter.emit('transaction.completed_after_retry', {
        transactionId: transaction.id,
        retryCount: transaction.retryCount,
        timestamp: new Date()
      });
    }
    
    this.logger.info(`Transaction ${transaction.id} completed successfully after ${transaction.retryCount} retries`);
    
    return completedTransaction;
  }

  /**
   * Mark a transaction as failed
   * @param transaction The transaction to mark as failed
   * @param error Error information
   */
  private async markAsFailed(
    transaction: Transaction,
    error: TransactionError
  ): Promise<Transaction> {
    const failedTransaction = {
      ...transaction,
      status: TransactionStatus.FAILED,
      error,
      updatedAt: new Date(),
      failedAt: new Date(),
      metadata: {
        ...transaction.metadata,
        failedAfterRetry: true,
        finalRetryCount: transaction.retryCount
      }
    };
    
    await this.store.save(failedTransaction);
    
    // Emit event
    if (this.eventEmitter) {
      await this.eventEmitter.emit('transaction.failed_after_retry', {
        transactionId: transaction.id,
        retryCount: transaction.retryCount,
        errorCode: error.code,
        timestamp: new Date()
      });
    }
    
    this.logger.info(`Transaction ${transaction.id} failed after ${transaction.retryCount} retries`, {
      errorCode: error.code
    });
    
    return failedTransaction;
  }

  /**
   * Get pending retries
   */
  async getPendingRetries(): Promise<Transaction[]> {
    try {
      return this.store.query('', {
        status: TransactionStatus.RECOVERY_PENDING
      });
    } catch (error) {
      this.logger.error('Failed to get pending retries', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to get pending retries',
        ErrorCode.DATABASE_ERROR
      );
    }
  }

  /**
   * Get retry statistics
   */
  async getRetryStats(): Promise<{
    pendingCount: number;
    avgRetryCount: number;
    successRate: number;
    retryCountDistribution: Record<number, number>;
  }> {
    try {
      // Get completed transactions that had retries
      const completedWithRetry = await this.store.query('', {
        status: TransactionStatus.COMPLETED
      });
      
      const completedAfterRetry = completedWithRetry.filter(tx => 
        tx.retryCount > 0 || tx.metadata?.completedAfterRetry
      );
      
      // Get failed transactions that had retries
      const failedWithRetry = await this.store.query('', {
        status: TransactionStatus.FAILED
      });
      
      const failedAfterRetry = failedWithRetry.filter(tx =>
        tx.retryCount > 0 || tx.metadata?.failedAfterRetry
      );
      
      // Get pending retries
      const pendingRetries = await this.getPendingRetries();
      
      // Calculate statistics
      const totalWithRetry = completedAfterRetry.length + failedAfterRetry.length;
      const successRate = totalWithRetry > 0 
        ? completedAfterRetry.length / totalWithRetry
        : 0;
      
      // Calculate average retry count for completed transactions
      const totalRetryCount = completedAfterRetry.reduce(
        (sum, tx) => sum + tx.retryCount, 
        0
      );
      
      const avgRetryCount = completedAfterRetry.length > 0
        ? totalRetryCount / completedAfterRetry.length
        : 0;
      
      // Calculate retry count distribution
      const retryCountDistribution: Record<number, number> = {};
      
      [...completedAfterRetry, ...failedAfterRetry].forEach(tx => {
        retryCountDistribution[tx.retryCount] = 
          (retryCountDistribution[tx.retryCount] || 0) + 1;
      });
      
      return {
        pendingCount: pendingRetries.length,
        avgRetryCount,
        successRate,
        retryCountDistribution
      };
    } catch (error) {
      this.logger.error('Failed to get retry statistics', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to get retry statistics',
        ErrorCode.INTERNAL_ERROR
      );
    }
  }
  
  /**
   * Check if an error is retryable
   * @param error The error to check
   */
  isRetryableError(error: TransactionError): boolean {
    // If error explicitly states if it's retryable, use that
    if (error.retryable !== undefined) {
      return error.retryable;
    }
    
    // Otherwise, determine based on error code
    const retryableErrorCodes = [
      TransactionErrorCode.NETWORK_ERROR,
      TransactionErrorCode.TIMEOUT,
      'network_error',
      'timeout_error',
      'api_connection_error',
      'processing_error',
      'rate_limit_error'
    ];
    
    return retryableErrorCodes.includes(error.code as any);
  }
}
