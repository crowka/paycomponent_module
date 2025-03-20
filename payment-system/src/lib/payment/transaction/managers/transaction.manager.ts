// src/lib/payment/transaction/managers/transaction.manager.ts

import { v4 as uuidv4 } from 'uuid';
import { 
  Transaction, 
  TransactionStatus, 
  TransactionType,
  TransactionError
} from '../../types/transaction.types';
import { TransactionStore } from '../store/transaction.store';
import { PaymentLogger } from '../../utils/logger';
import { EventEmitter } from '../../events/event.emitter';
import { errorHandler, ErrorCode } from '../../utils/error';
import { RecordLocker, LockLevel } from '../../utils/record-locker';
import { RecoveryManager } from './recovery.manager';
import { RetryManager } from './retry.manager';

/**
 * Options for TransactionManager
 */
export interface TransactionManagerOptions {
  eventEmitter?: EventEmitter;
  recoveryManager?: RecoveryManager;
  retryManager?: RetryManager;
  recordLocker?: RecordLocker;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Manages transaction lifecycle, persistence, and coordination with
 * recovery and retry functionality.
 */
export class TransactionManager {
  private logger: PaymentLogger;
  private eventEmitter?: EventEmitter;
  private recoveryManager?: RecoveryManager;
  private retryManager?: RetryManager;
  private recordLocker?: RecordLocker;
  private lockTimeoutMs: number = 10000; // 10 seconds
  
  constructor(
    private store: TransactionStore,
    options: TransactionManagerOptions = {}
  ) {
    this.logger = new PaymentLogger(options.logLevel || 'info', 'TransactionManager');
    this.eventEmitter = options.eventEmitter;
    this.recoveryManager = options.recoveryManager;
    this.retryManager = options.retryManager;
    this.recordLocker = options.recordLocker;
  }

  /**
   * Begin a new transaction
   * @param type Type of transaction
   * @param data Transaction data
   * @returns New transaction
   */
  async beginTransaction(
    type: TransactionType,
    data: Omit<Transaction, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'retryCount'>
  ): Promise<Transaction> {
    const operationId = uuidv4().slice(0, 8);
    
    try {
      // Check for existing transaction with same idempotency key
      if (data.idempotencyKey) {
        const existingTransaction = await this.store.getByIdempotencyKey(data.idempotencyKey);
        
        if (existingTransaction) {
          this.logger.info(`[${operationId}] Found existing transaction with idempotency key ${data.idempotencyKey}`, {
            transactionId: existingTransaction.id,
            status: existingTransaction.status
          });
          
          return existingTransaction;
        }
      }
      
      // Create new transaction
      const transaction: Transaction = {
        id: uuidv4(),
        type,
        status: TransactionStatus.PENDING,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data
      };
      
      this.logger.info(`[${operationId}] Creating new transaction`, {
        transactionId: transaction.id,
        type,
        amount: transaction.amount,
        currency: transaction.currency
      });
      
      // Save transaction
      await this.store.save(transaction);
      
      // Emit event
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.created', {
          transactionId: transaction.id,
          type,
          amount: transaction.amount,
          currency: transaction.currency,
          status: transaction.status,
          timestamp: transaction.createdAt
        });
      }
      
      return transaction;
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to create transaction`, { error });
      
      throw errorHandler.wrapError(
        error,
        'Failed to create transaction',
        ErrorCode.INTERNAL_ERROR,
        { type, ...data }
      );
    }
  }
  
  /**
   * Handle transaction error with retry/recovery
   * @param id Transaction ID
   * @param error Error that occurred
   */
  async handleTransactionError(
    id: string,
    error: TransactionError
  ): Promise<Transaction> {
    const operationId = uuidv4().slice(0, 8);
    
    try {
      this.logger.info(`[${operationId}] Handling error for transaction ${id}`, {
        errorCode: error.code,
        retryable: error.retryable,
        recoverable: error.recoverable
      });
      
      // Get transaction
      const transaction = await this.store.get(id);
      if (!transaction) {
        throw errorHandler.createError(
          `Transaction not found: ${id}`,
          ErrorCode.TRANSACTION_NOT_FOUND,
          { transactionId: id }
        );
      }
      
      // Check if retryable and we have a retry manager
      if (error.retryable && this.retryManager) {
        this.logger.info(`[${operationId}] Error is retryable, scheduling retry for transaction ${id}`);
        return this.retryManager.scheduleRetry(transaction, error);
      }
      
      // If recoverable and we have a recovery manager
      if (error.recoverable && this.recoveryManager) {
        this.logger.info(`[${operationId}] Error is recoverable, initiating recovery for transaction ${id}`);
        return this.recoveryManager.initiateRecovery(transaction, error);
      }
      
      // Otherwise, mark as failed
      this.logger.info(`[${operationId}] Error is not retryable or recoverable, marking transaction ${id} as failed`);
      
      return this.updateTransactionStatus(
        id, 
        TransactionStatus.FAILED,
        {
          failureReason: error.code,
          failureMessage: error.message,
          failureDetails: error.details
        }
      );
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to handle transaction error for ${id}`, { error });
      
      throw errorHandler.wrapError(
        error,
        'Failed to handle transaction error',
        ErrorCode.INTERNAL_ERROR,
        { transactionId: id }
      );
    }
  }
  
  /**
   * Get a transaction by ID
   * @param id Transaction ID
   */
  async getTransaction(id: string): Promise<Transaction | null> {
    try {
      return this.store.get(id);
    } catch (error) {
      this.logger.error(`Failed to get transaction ${id}`, { error });
      
      throw errorHandler.wrapError(
        error,
        'Failed to get transaction',
        ErrorCode.INTERNAL_ERROR,
        { transactionId: id }
      );
    }
  }
  
  /**
   * Get transactions for a customer
   * @param customerId Customer ID
   * @param options Query options
   */
  async getTransactions(
    customerId: string,
    options: {
      status?: TransactionStatus;
      type?: TransactionType;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<Transaction[]> {
    try {
      return this.store.query(customerId, options);
    } catch (error) {
      this.logger.error(`Failed to get transactions for customer ${customerId}`, { error });
      
      throw errorHandler.wrapError(
        error,
        'Failed to get transactions',
        ErrorCode.INTERNAL_ERROR,
        { customerId, options }
      );
    }
  }
  
  /**
   * Validate state transition
   * @param currentState Current state
   * @param newState New state
   */
  private validateStateTransition(
    currentState: TransactionStatus,
    newState: TransactionStatus
  ): void {
    // Define valid state transitions
    const validTransitions: Record<TransactionStatus, TransactionStatus[]> = {
      [TransactionStatus.PENDING]: [
        TransactionStatus.PROCESSING,
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED,
        TransactionStatus.RECOVERY_PENDING
      ],
      [TransactionStatus.PROCESSING]: [
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED,
        TransactionStatus.RECOVERY_PENDING
      ],
      [TransactionStatus.COMPLETED]: [],
      [TransactionStatus.FAILED]: [
        TransactionStatus.RECOVERY_PENDING
      ],
      [TransactionStatus.RECOVERY_PENDING]: [
        TransactionStatus.PROCESSING,
        TransactionStatus.RECOVERY_IN_PROGRESS,
        TransactionStatus.FAILED
      ],
      [TransactionStatus.RECOVERY_IN_PROGRESS]: [
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED,
        TransactionStatus.RECOVERY_PENDING
      ]
    };
    
    // No state change is always valid
    if (currentState === newState) {
      return;
    }
    
    // Check if transition is valid
    if (!validTransitions[currentState]?.includes(newState)) {
      throw errorHandler.createError(
        `Invalid state transition from ${currentState} to ${newState}`,
        ErrorCode.TRANSACTION_INVALID_STATE,
        { currentState, newState }
      );
    }
  }

  /**
   * Update transaction status
   * @param id Transaction ID
   * @param status New status
   * @param metadata Optional metadata to update
   */
  async updateTransactionStatus(
    id: string,
    status: TransactionStatus,
    metadata?: Record<string, any>
  ): Promise<Transaction> {
    const operationId = uuidv4().slice(0, 8);
    let lockId: string | undefined;
    
    try {
      this.logger.info(`[${operationId}] Updating transaction ${id} status to ${status}`);
      
      // Try to acquire lock if locker is available
      if (this.recordLocker) {
        try {
          lockId = await this.recordLocker.acquireLock(
            id,
            'transaction',
            { 
              waitTimeoutMs: this.lockTimeoutMs,
              lockLevel: LockLevel.EXCLUSIVE
            }
          );
          this.logger.debug(`[${operationId}] Acquired lock for transaction ${id}`);
        } catch (lockError) {
          this.logger.error(`[${operationId}] Failed to acquire lock for transaction ${id}`, { 
            error: lockError 
          });
          // Continue without lock, but this is not optimal
        }
      }
      
      // Get transaction
      const transaction = await this.store.get(id);
      if (!transaction) {
        throw errorHandler.createError(
          `Transaction not found: ${id}`,
          ErrorCode.TRANSACTION_NOT_FOUND,
          { transactionId: id }
        );
      }
      
      // Validate state transition
      this.validateStateTransition(transaction.status, status);
      
      // Update transaction
      const updatedTransaction = {
        ...transaction,
        status,
        updatedAt: new Date(),
        metadata: {
          ...transaction.metadata,
          ...metadata
        },
        ...(status === TransactionStatus.COMPLETED && { completedAt: new Date() }),
        ...(status === TransactionStatus.FAILED && { failedAt: new Date() })
      };
      
      await this.store.save(updatedTransaction);
      
      // Emit event
      if (this.eventEmitter) {
        await this.eventEmitter.emit('transaction.status_changed', {
          transactionId: id,
          oldStatus: transaction.status,
          newStatus: status,
          timestamp: updatedTransaction.updatedAt
        });
      }
      
      this.logger.info(`[${operationId}] Updated transaction ${id} status from ${transaction.status} to ${status}`);
      
      return updatedTransaction;
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to update transaction ${id} status`, { error });
      
      throw errorHandler.wrapError(
        error,
        `Failed to update transaction status to ${status}`,
        ErrorCode.INTERNAL_ERROR,
        { transactionId: id, status }
      );
    } finally {
      // Release lock if acquired
      if (this.recordLocker && lockId) {
        try {
          await this.recordLocker.releaseLock(id, 'transaction', lockId);
          this.logger.debug(`[${operationId}] Released lock for transaction ${id}`);
        } catch (releaseError) {
          this.logger.error(`[${operationId}] Failed to release lock for transaction ${id}`, {
            error: releaseError
          });
        }
      }
    }
