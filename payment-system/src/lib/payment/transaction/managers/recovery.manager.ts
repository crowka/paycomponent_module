// src/lib/payment/transaction/managers/recovery.manager.ts
import { v4 as uuidv4 } from 'uuid';
import { 
  Transaction, 
  TransactionStatus, 
  TransactionError,
  RecoveryStrategy 
} from '../types';
import { TransactionStore } from '../store/transaction.store';
import { DeadLetterQueue } from '../recovery/queue/dead-letter.queue';
import { PaymentLogger } from '../../utils/logger';
import { EventEmitter } from '../../events/event.emitter';
import { errorHandler, ErrorCode } from '../../utils/error';
import { RecordLocker, LockLevel } from '../../utils/record-locker';

export interface RecoveryOptions {
  maxAttempts?: number;
  lockTimeoutMs?: number;
  eventEmitter?: EventEmitter;
  recordLocker?: RecordLocker;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export class RecoveryManager {
  private logger: PaymentLogger;
  private eventEmitter?: EventEmitter;
  private recordLocker?: RecordLocker;
  private maxAttempts: number;
  private lockTimeoutMs: number;

  constructor(
    private store: TransactionStore,
    private deadLetterQueue: DeadLetterQueue,
    private strategies: RecoveryStrategy[],
    private retryManager: any, // Added retryManager
    options: RecoveryOptions = {}
  ) {
    this.logger = new PaymentLogger(options.logLevel || 'info', 'RecoveryManager');
    this.eventEmitter = options.eventEmitter;
    this.recordLocker = options.recordLocker;
    this.maxAttempts = options.maxAttempts || 3;
    this.lockTimeoutMs = options.lockTimeoutMs || 10000; // 10 seconds default

    this.validateStrategies();
  }

  /**
   * Initiate recovery process for a failed transaction
   */
  async initiateRecovery(
    transaction: Transaction,
    error: TransactionError
  ): Promise<Transaction> {
    const operationId = uuidv4().slice(0, 8);
    let lockId: string | undefined;

    try {
      this.logger.info(`[${operationId}] Initiating recovery for transaction ${transaction.id}`, {
        status: transaction.status,
        errorCode: error.code,
        recoverable: error.recoverable
      });

      // Add proper coordination with retry system
      if (error.retryable && transaction.retryCount < this.maxAttempts) {
        // Use retry manager instead of direct recovery
        return this.retryManager.scheduleRetry(transaction);
      }
      
      // Only proceed with recovery for recoverable errors
      if (!error.recoverable) {
        return this.moveToDeadLetter(transaction, error, operationId);
      }

      // Validate transaction can be recovered
      this.validateTransaction(transaction);

      // Acquire lock if locker is available
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
          this.logger.error(`[${operationId}] Failed to acquire lock for transaction ${transaction.id}`, { error: lockError });
          // Continue without lock, but this is suboptimal
        }
      }

      // Update transaction status to recovery in progress
      const updatedTransaction = {
        ...transaction,
        status: TransactionStatus.RECOVERY_IN_PROGRESS,
        updatedAt: new Date()
      };

      await this.store.save(updatedTransaction);
      
      // Emit event for recovery started
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.recovery_started', {
          transactionId: transaction.id,
          status: updatedTransaction.status,
          errorCode: error.code
        });
      }

      // Find the appropriate recovery strategy
      const strategy = this.findRecoveryStrategy(error);
      
      if (!strategy) {
        this.logger.warn(`[${operationId}] No recovery strategy found for error: ${error.code}`);
        return this.moveToDeadLetter(updatedTransaction, error, operationId);
      }

      // Execute the strategy
      try {
        this.logger.info(`[${operationId}] Executing recovery strategy for transaction ${transaction.id}`, {
          strategy: strategy.type
        });

        const recoveryResult = await strategy.execute(updatedTransaction);
        
        // If recovery succeeds, complete the transaction
        if (recoveryResult.success) {
          return this.completeRecovery(updatedTransaction, recoveryResult.data, operationId);
        } else {
          // If recovery failed, move to dead letter queue with the new error
          return this.moveToDeadLetter(
            updatedTransaction, 
            recoveryResult.error || error, 
            operationId
          );
        }
      } catch (recoveryError) {
        // Add detailed error context
        const enhancedError = {
          code: 'RECOVERY_EXECUTION_ERROR',
          message: recoveryError.message || 'Error executing recovery strategy',
          recoverable: false,
          retryable: transaction.retryCount < this.maxAttempts - 1,
          details: { 
            originalErrorCode: error.code,
            strategyType: strategy.type,
            transactionId: transaction.id,
            attemptCount: transaction.retryCount
          }
        };
        
        // Log with additional context
        this.logger.error(`Recovery strategy execution failed`, {
          error: recoveryError,
          transactionId: transaction.id,
          strategy: strategy.type,
          enhancedError
        });
        
        return this.moveToDeadLetter(updatedTransaction, enhancedError, operationId);
      }
    } catch (error) {
      this.logger.error(`Failed to initiate recovery for transaction ${transaction.id}`, { error });
      
      // Ensure transaction is marked as failed in case of unhandled errors
      const failedTransaction = {
        ...transaction,
        status: TransactionStatus.FAILED,
        error: {
          code: 'RECOVERY_FAILED',
          message: error.message || 'Recovery failed due to system error',
          recoverable: false,
          retryable: false
        },
        updatedAt: new Date(),
        failedAt: new Date()
      };

      try {
        await this.store.save(failedTransaction);
      } catch (saveError) {
        this.logger.error(`Failed to update transaction status after recovery failure`, {
          transactionId: transaction.id,
          error: saveError
        });
      }

      throw errorHandler.wrapError(
        error,
        'Recovery process failed',
        ErrorCode.RECOVERY_ERROR,
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
   * Find the appropriate recovery strategy for an error
   */
  private findRecoveryStrategy(error: TransactionError): RecoveryStrategy | undefined {
    // First check for strategies that explicitly handle this error code
    const exactMatch = this.strategies.find(s => s.canHandle && s.canHandle(error));
    if (exactMatch) {
      return exactMatch;
    }

    // As a fallback, check for general recovery strategies
    return this.strategies.find(s => s.isGeneral);
  }

  /**
   * Update transaction status to completed after successful recovery
   */
  private async completeRecovery(
    transaction: Transaction,
    resultData?: any,
    operationId?: string
  ): Promise<Transaction> {
    const completedTransaction = {
      ...transaction,
      status: TransactionStatus.COMPLETED,
      metadata: {
        ...transaction.metadata,
        recoveryResult: resultData,
        recoveredAt: new Date()
      },
      updatedAt: new Date(),
      completedAt: new Date()
    };

    await this.store.save(completedTransaction);
    
    this.logger.info(`[${operationId || 'unknown'}] Recovery completed successfully for transaction ${transaction.id}`);
    
    // Emit recovery completed event
    if (this.eventEmitter) {
      await this.eventEmitter.emit('transaction.recovery_completed', {
        transactionId: transaction.id,
        status: completedTransaction.status
      });
    }

    return completedTransaction;
  }

  /**
   * Move failed transaction to dead letter queue
   */
  private async moveToDeadLetter(
    transaction: Transaction,
    error: TransactionError,
    operationId?: string
  ): Promise<Transaction> {
    const failedTransaction = {
      ...transaction,
      status: TransactionStatus.FAILED,
      error,
      updatedAt: new Date(),
      failedAt: new Date()
    };

    await this.store.save(failedTransaction);
    
    try {
      // Enqueue the transaction in the dead letter queue
      await this.deadLetterQueue.enqueue(failedTransaction);
      
      this.logger.info(`[${operationId || 'unknown'}] Transaction ${transaction.id} moved to dead letter queue`, {
        errorCode: error.code
      });
      
      // Emit event for transaction moved to DLQ
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.moved_to_dlq', {
          transactionId: transaction.id,
          errorCode: error.code
        });
      }
    } catch (dlqError) {
      this.logger.error(`[${operationId || 'unknown'}] Failed to enqueue transaction in dead letter queue`, {
        error: dlqError,
        transactionId: transaction.id
      });
      
      // Note: We don't rethrow here as the transaction is already marked as failed
    }
    
    return failedTransaction;
  }

  /**
   * Reprocess a transaction from the dead letter queue
   */
  async reprocessFromDeadLetter(transactionId: string): Promise<Transaction> {
    const operationId = uuidv4().slice(0, 8);
    let lockId: string | undefined;

    try {
      this.logger.info(`[${operationId}] Reprocessing transaction ${transactionId} from dead letter queue`);
      
      // Get transaction from store
      const transaction = await this.store.get(transactionId);
      if (!transaction) {
        throw errorHandler.createError(
          `Transaction not found: ${transactionId}`,
          ErrorCode.TRANSACTION_NOT_FOUND,
          { transactionId }
        );
      }

      // Acquire lock if available
      if (this.recordLocker) {
        try {
          lockId = await this.recordLocker.acquireLock(
            transactionId,
            'transaction',
            { 
              waitTimeoutMs: this.lockTimeoutMs,
              lockLevel: LockLevel.EXCLUSIVE
            }
          );
        } catch (lockError) {
          this.logger.error(`[${operationId}] Failed to acquire lock for reprocessing transaction ${transactionId}`, {
            error: lockError
          });
          // Continue without lock, but this is suboptimal
        }
      }

      // Verify transaction is in a reprocessable state
      if (transaction.status !== TransactionStatus.FAILED) {
        throw errorHandler.createError(
          `Cannot reprocess transaction in ${transaction.status} state`,
          ErrorCode.TRANSACTION_INVALID_STATE,
          { transactionId, status: transaction.status }
        );
      }

      // Update transaction status to recovery pending
      const updatedTransaction = {
        ...transaction,
        status: TransactionStatus.RECOVERY_PENDING,
        updatedAt: new Date()
      };

      await this.store.save(updatedTransaction);
      
      // Remove from dead letter queue
      await this.deadLetterQueue.remove(transactionId);
      
      // Emit event for reprocessing
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.reprocessing', {
          transactionId,
          previousStatus: transaction.status
        });
      }
      
      // Re-run recovery process with original error if available
      const errorToUse = transaction.error || {
        code: 'UNKNOWN_ERROR',
        message: 'No error information available',
        recoverable: true,
        retryable: true
      };
      
      return this.initiateRecovery(updatedTransaction, errorToUse);
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to reprocess transaction from dead letter queue`, {
        error,
        transactionId
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to reprocess transaction from dead letter queue',
        ErrorCode.RECOVERY_ERROR,
        { transactionId }
      );
    } finally {
      // Release lock if acquired
      if (this.recordLocker && lockId) {
        try {
          await this.recordLocker.releaseLock(transactionId, 'transaction', lockId);
        } catch (releaseError) {
          this.logger.error(`[${operationId}] Failed to release lock for transaction ${transactionId}`, {
            error: releaseError
          });
        }
      }
    }
  }

  /**
   * Get counts of transactions by status in dead letter queue
   */
  async getDeadLetterQueueStats(): Promise<Record<string, number>> {
    try {
      const transactions = await this.deadLetterQueue.getAll();
      
      // Group and count by error code
      const errorCounts: Record<string, number> = {};
      
      transactions.forEach(tx => {
        const code = tx.error?.code || 'UNKNOWN';
        errorCounts[code] = (errorCounts[code] || 0) + 1;
      });
      
      return {
        total: transactions.length,
        ...errorCounts
      };
    } catch (error) {
      this.logger.error('Failed to get dead letter queue stats', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to get dead letter queue stats',
        ErrorCode.INTERNAL_ERROR
      );
    }
  }

  /**
   * Register a new recovery strategy
   */
  registerStrategy(strategy: RecoveryStrategy): void {
    // Validate strategy implements required methods
    if (!strategy.execute || typeof strategy.execute !== 'function') {
      throw errorHandler.createError(
        'Invalid recovery strategy: missing execute method',
        ErrorCode.CONFIGURATION_ERROR
      );
    }
    
    if (!strategy.canHandle && !strategy.isGeneral) {
      throw errorHandler.createError(
        'Invalid recovery strategy: must implement canHandle or set isGeneral flag',
        ErrorCode.CONFIGURATION_ERROR
      );
    }

    this.strategies.push(strategy);
    this.logger.info(`Registered recovery strategy: ${strategy.type}`);
  }

  /**
   * Validate strategies configuration
   */
  private validateStrategies(): void {
    // Ensure we have at least one strategy
    if (!this.strategies || this.strategies.length === 0) {
      this.logger.warn('No recovery strategies configured');
      return;
    }

    // Ensure all strategies implement required methods
    for (const strategy of this.strategies) {
      if (!strategy.execute || typeof strategy.execute !== 'function') {
        throw errorHandler.createError(
          `Invalid recovery strategy: missing execute method`,
          ErrorCode.CONFIGURATION_ERROR,
          { strategyType: strategy.type }
        );
      }

      if (!strategy.canHandle && !strategy.isGeneral) {
        this.logger.warn(`Recovery strategy ${strategy.type} has no canHandle method and is not marked as general`);
      }
    }
  }

  /**
   * Validate transaction can be recovered
   */
  private validateTransaction(transaction: Transaction): void {
    // Check if transaction is in a recoverable state
    const recoverableStates = [
      TransactionStatus.PENDING,
      TransactionStatus.PROCESSING,
      TransactionStatus.RECOVERY_PENDING
    ];

    if (!recoverableStates.includes(transaction.status)) {
      throw errorHandler.createError(
        `Cannot recover transaction in ${transaction.status} state`,
        ErrorCode.TRANSACTION_INVALID_STATE,
        { 
          transactionId: transaction.id,
          status: transaction.status,
          recoverableStates
        }
      );
    }

    // Check if transaction has not exceeded max recovery attempts
    const recoveryAttempts = transaction.metadata?.recoveryAttempts || 0;
    if (recoveryAttempts >= this.maxAttempts) {
      throw errorHandler.createError(
        `Transaction recovery limit reached (${recoveryAttempts}/${this.maxAttempts})`,
        ErrorCode.RECOVERY_LIMIT_EXCEEDED,
        {
          transactionId: transaction.id,
          attempts: recoveryAttempts,
          maxAttempts: this.maxAttempts
        }
      );
    }
  }
}
