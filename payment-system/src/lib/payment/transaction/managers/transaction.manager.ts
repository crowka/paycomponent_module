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
import { PaymentLogger } from '../../utils/logger';
import { errorHandler, ErrorCode } from '../../utils/error';
import { EventEmitter } from '../../events/event.emitter';

// Distributed lock record structure
interface TransactionLock {
  transactionId: string;
  acquiredAt: Date;
  expiresAt: Date;
  owner: string;
  renewed?: Date;
}

export class TransactionManager {
  private logger: PaymentLogger;
  private locks: Map<string, TransactionLock> = new Map();
  private lockExpirationMs: number = 30000; // 30 seconds
  private lockRenewalIntervalMs: number = 10000; // 10 seconds
  private instanceId: string = uuidv4(); // Unique ID for this instance
  private renewalTimers: Map<string, NodeJS.Timeout> = new Map();
  private eventEmitter?: EventEmitter;

  constructor(
    private store: TransactionStore,
    private idempotencyManager: IdempotencyManager,
    private retryManager: RetryManager,
    private recoveryManager: RecoveryManager,
    options: {
      eventEmitter?: EventEmitter;
      lockExpirationMs?: number;
      lockRenewalIntervalMs?: number;
    } = {}
  ) {
    this.logger = new PaymentLogger('info', 'TransactionManager');
    this.lockExpirationMs = options.lockExpirationMs || this.lockExpirationMs;
    this.lockRenewalIntervalMs = options.lockRenewalIntervalMs || this.lockRenewalIntervalMs;
    this.eventEmitter = options.eventEmitter;
  }

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
    const operationId = this.generateOperationId();
    this.logger.info(`[${operationId}] Beginning transaction`, { 
      type, 
      customerId: data.customerId,
      amount: data.amount,
      currency: data.currency
    });

    try {
      // Check for existing transaction with the same idempotency key
      const existingTransaction = await this.store.findByIdempotencyKey(data.idempotencyKey);
      if (existingTransaction) {
        this.logger.info(`[${operationId}] Found existing transaction with idempotency key`, { 
          idempotencyKey: data.idempotencyKey,
          transactionId: existingTransaction.id
        });
        return existingTransaction;
      }

      // Check idempotency
      await this.idempotencyManager.checkAndLock(data.idempotencyKey, {
        type,
        amount: data.amount,
        currency: data.currency,
        customerId: data.customerId,
        paymentMethodId: data.paymentMethodId
      });

      const transaction: Transaction = {
        id: uuidv4(),
        type,
        status: TransactionStatus.PENDING,
        ...data,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Acquire lock for the new transaction
      await this.acquireLock(transaction.id);

      try {
        await this.store.save(transaction);
        
        // Associate transaction with idempotency key
        await this.idempotencyManager.associateResource(
          data.idempotencyKey, 
          transaction.id, 
          'transaction'
        );
        
        this.logger.info(`[${operationId}] Transaction created`, { 
          transactionId: transaction.id, 
          status: transaction.status 
        });
        
        // Emit transaction created event
        if (this.eventEmitter) {
          await this.eventEmitter.emit('transaction.created', {
            transactionId: transaction.id,
            customerId: transaction.customerId,
            type: transaction.type,
            amount: transaction.amount,
            currency: transaction.currency
          });
        }
        
        return transaction;
      } catch (error) {
        // Release lock if saving fails
        await this.releaseLock(transaction.id);
        throw error;
      }
    } catch (error) {
      if (error.message === 'Duplicate request' || error.code === ErrorCode.DUPLICATE_REQUEST) {
        throw errorHandler.createError(
          'Duplicate transaction request',
          ErrorCode.DUPLICATE_REQUEST,
          { idempotencyKey: data.idempotencyKey }
        );
      }
      
      this.logger.error(`[${operationId}] Transaction creation failed`, { 
        error, 
        type, 
        customerId: data.customerId 
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to begin transaction',
        ErrorCode.INTERNAL_ERROR,
        { type, customerId: data.customerId }
      );
    }
  }

  async updateTransactionStatus(
    transactionId: string,
    status: TransactionStatus,
    error?: TransactionError
  ): Promise<Transaction> {
    const operationId = this.generateOperationId();
    this.logger.info(`[${operationId}] Updating transaction status`, { 
      transactionId, 
      newStatus: status 
    });
    
    try {
      // Acquire lock before updating
      await this.acquireLock(transactionId);
      
      try {
        const transaction = await this.getTransaction(transactionId);
        if (!transaction) {
          throw errorHandler.createError(
            'Transaction not found',
            ErrorCode.TRANSACTION_NOT_FOUND,
            { transactionId }
          );
        }

        // Validate state transition
        this.validateStateTransition(transaction.status, status);

        const updatedTransaction = {
          ...transaction,
          status,
          error,
          updatedAt: new Date(),
          ...(status === TransactionStatus.COMPLETED && { completedAt: new Date() }),
          ...(status === TransactionStatus.FAILED && { failedAt: new Date() })
        };

        await this.store.save(updatedTransaction);
        
        this.logger.info(`[${operationId}] Transaction status updated`, { 
          transactionId, 
          oldStatus: transaction.status,
          newStatus: status 
        });
        
        // Emit transaction status changed event
        if (this.eventEmitter) {
          await this.eventEmitter.emit('transaction.status_changed', {
            transactionId,
            oldStatus: transaction.status,
            newStatus: status,
            error: error ? { 
              code: error.code,
              message: error.message 
            } : undefined
          });
        }
        
        // Handle idempotency key release if transaction is in terminal state
        if (this.isTerminalState(status) && transaction.idempotencyKey) {
          await this.idempotencyManager.releaseLock(transaction.idempotencyKey);
          this.logger.debug(`[${operationId}] Released idempotency lock`, { 
            transactionId, 
            idempotencyKey: transaction.idempotencyKey 
          });
        }
        
        // Release transaction lock if in terminal state
        if (this.isTerminalState(status)) {
          await this.releaseLock(transactionId);
        }
        
        return updatedTransaction;
      } catch (error) {
        // Release lock if update fails
        await this.releaseLock(transactionId);
        throw error;
      }
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to update transaction status`, { 
        error, 
        transactionId, 
        status 
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to update transaction status',
        ErrorCode.INTERNAL_ERROR,
        { transactionId, status }
      );
    }
  }

  async handleTransactionError(
    transactionId: string,
    error: TransactionFailedError
  ): Promise<Transaction> {
    const operationId = this.generateOperationId();
    try {
      // Acquire lock before handling error
      await this.acquireLock(transactionId);
      
      try {
        this.logger.info(`[${operationId}] Handling transaction error`, { 
          transactionId, 
          errorCode: error.code,
          retryable: error.retryable,
          recoverable: error.recoverable
        });
        
        const transaction = await this.getTransaction(transactionId);
        if (!transaction) {
          throw errorHandler.createError(
            'Transaction not found',
            ErrorCode.TRANSACTION_NOT_FOUND,
            { transactionId }
          );
        }

        // Handle retryable errors
        if (error.retryable && transaction.retryCount < this.retryManager.getMaxRetries()) {
          this.logger.info(`[${operationId}] Scheduling transaction retry`, { 
            transactionId, 
            retryCount: transaction.retryCount 
          });
          
          // Release lock before scheduling retry (retry process will acquire lock again)
          await this.releaseLock(transactionId);
          
          return this.retryManager.scheduleRetry(transaction);
        }

        // Handle recoverable errors
        if (error.recoverable) {
          this.logger.info(`[${operationId}] Initiating transaction recovery`, { transactionId });
          
          // Release lock before recovery (recovery process will acquire lock again)
          await this.releaseLock(transactionId);
          
          return this.recoveryManager.initiateRecovery(transaction, error);
        }

        // Handle terminal errors
        this.logger.info(`[${operationId}] Marking transaction as failed`, { 
          transactionId, 
          errorCode: error.code 
        });
        
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
      } catch (error) {
        // Release lock if handling fails
        await this.releaseLock(transactionId);
        throw error;
      }
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to handle transaction error`, { 
        error, 
        transactionId 
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to handle transaction error',
        ErrorCode.INTERNAL_ERROR,
        { transactionId }
      );
    }
  }

  async rollbackTransaction(transactionId: string): Promise<Transaction> {
    const operationId = this.generateOperationId();
    try {
      // Acquire lock before rollback
      await this.acquireLock(transactionId);
      
      try {
        this.logger.info(`[${operationId}] Rolling back transaction`, { transactionId });
        
        const transaction = await this.getTransaction(transactionId);
        if (!transaction) {
          throw errorHandler.createError(
            'Transaction not found',
            ErrorCode.TRANSACTION_NOT_FOUND,
            { transactionId }
          );
        }

        // Check if transaction can be rolled back
        if (this.isTerminalState(transaction.status)) {
          throw errorHandler.createError(
            `Cannot rollback transaction in ${transaction.status} state`,
            ErrorCode.TRANSACTION_INVALID_STATE,
            { transactionId, status: transaction.status }
          );
        }

        // Implement rollback logic based on transaction type
        switch (transaction.type) {
          case TransactionType.PAYMENT:
            await this.rollbackPayment(transaction);
            break;
          case TransactionType.REFUND:
            await this.rollbackRefund(transaction);
            break;
          case TransactionType.CHARGEBACK:
            await this.rollbackChargeback(transaction);
            break;
          default:
            throw errorHandler.createError(
              `Unsupported transaction type: ${transaction.type}`,
              ErrorCode.VALIDATION_ERROR,
              { transactionId, type: transaction.type }
            );
        }

        return this.updateTransactionStatus(
          transactionId,
          TransactionStatus.ROLLED_BACK
        );
      } catch (error) {
        // Release lock if rollback fails
        await this.releaseLock(transactionId);
        throw error;
      }
    } catch (error) {
      this.logger.error(`[${operationId}] Failed to rollback transaction`, { 
        error, 
        transactionId 
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to rollback transaction',
        ErrorCode.INTERNAL_ERROR,
        { transactionId }
      );
    }
  }

  async getTransaction(transactionId: string): Promise<Transaction | null> {
    try {
      const transaction = await this.store.get(transactionId);
      return transaction;
    } catch (error) {
      throw errorHandler.wrapError(
        error,
        'Failed to get transaction',
        ErrorCode.INTERNAL_ERROR,
        { transactionId }
      );
    }
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
    } = {}
  ): Promise<Transaction[]> {
    try {
      return this.store.query(customerId, options);
    } catch (error) {
      throw errorHandler.wrapError(
        error,
        'Failed to list transactions',
        ErrorCode.INTERNAL_ERROR,
        { customerId, options }
      );
    }
  }

  async checkTransactionLimits(
    customerId: string,
    amount: number,
    currency: string
  ): Promise<boolean> {
    // This would typically call into the customer service to check limits
    // Placeholder implementation
    return true;
  }

  /**
   * Acquire a lock on a transaction to prevent concurrent modifications
   */
  private async acquireLock(transactionId: string): Promise<boolean> {
    // Check if lock exists and is still valid
    const existingLock = this.locks.get(transactionId);
    if (existingLock) {
      const now = new Date();
      
      // If lock is owned by this instance, renew it
      if (existingLock.owner === this.instanceId) {
        existingLock.renewed = now;
        existingLock.expiresAt = new Date(now.getTime() + this.lockExpirationMs);
        this.logger.debug(`Renewed transaction lock for ${transactionId}`);
        return true;
      }
      
      // If lock has expired, take it over
      if (now > existingLock.expiresAt) {
        this.logger.warn(`Taking over expired lock for transaction ${transactionId}`, {
          previousOwner: existingLock.owner,
          expiredAt: existingLock.expiresAt
        });
      } else {
        // Lock is valid and owned by someone else
        throw errorHandler.createError(
          'Transaction is locked by another process',
          ErrorCode.TRANSACTION_LOCKED,
          { 
            transactionId,
            lockedSince: existingLock.acquiredAt,
            lockExpiration: existingLock.expiresAt
          }
        );
      }
    }
    
    // Create new lock
    const now = new Date();
    const lock: TransactionLock = {
      transactionId,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + this.lockExpirationMs),
      owner: this.instanceId
    };
    
    this.locks.set(transactionId, lock);
    this.logger.debug(`Acquired transaction lock for ${transactionId}`);
    
    // Set up automatic lock renewal
    this.setupLockRenewal(transactionId);
    
    // Emit lock acquired event
    if (this.eventEmitter) {
      this.eventEmitter.emit('transaction.lock_acquired', {
        transactionId,
        owner: this.instanceId,
        acquiredAt: now
      }).catch(error => {
        this.logger.error('Failed to emit lock acquired event', { error });
      });
    }
    
    return true;
  }

  /**
   * Release a lock on a transaction
   */
  private async releaseLock(transactionId: string): Promise<void> {
    const lock = this.locks.get(transactionId);
    if (lock && lock.owner === this.instanceId) {
      this.locks.delete(transactionId);
      
      // Clear any renewal timer
      const timer = this.renewalTimers.get(transactionId);
      if (timer) {
        clearTimeout(timer);
        this.renewalTimers.delete(transactionId);
      }
      
      this.logger.debug(`Released transaction lock for ${transactionId}`);
      
      // Emit lock released event
      if (this.eventEmitter) {
        this.eventEmitter.emit('transaction.lock_released', {
          transactionId,
          owner: this.instanceId
        }).catch(error => {
          this.logger.error('Failed to emit lock released event', { error });
        });
      }
    }
  }

  /**
   * Setup automatic lock renewal to prevent expiration during long operations
   */
  private setupLockRenewal(transactionId: string): void {
    // Clear any existing timer
    const existingTimer = this.renewalTimers.get(transactionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set up new timer
    const timer = setTimeout(async () => {
      try {
        const lock = this.locks.get(transactionId);
        if (lock && lock.owner === this.instanceId) {
          const now = new Date();
          lock.renewed = now;
          lock.expiresAt = new Date(now.getTime() + this.lockExpirationMs);
          this.logger.debug(`Auto-renewed transaction lock for ${transactionId}`);
          
          // Set up next renewal
          this.setupLockRenewal(transactionId);
        }
      } catch (error) {
        this.logger.error(`Failed to renew lock for transaction ${transactionId}`, { error });
      }
    }, this.lockRenewalIntervalMs);
    
    // Store timer reference for cleanup
    this.renewalTimers.set(transactionId, timer);
  }

  private validateStateTransition(
    currentState: TransactionStatus,
    newState: TransactionStatus
  ): void {
    // Define valid state transitions
    const validTransitions: Record<TransactionStatus, TransactionStatus[]> = {
      [TransactionStatus.PENDING]: [
        TransactionStatus.PROCESSING,
        TransactionStatus.FAILED,
        TransactionStatus.ROLLED_BACK
      ],
      [TransactionStatus.PROCESSING]: [
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED,
        TransactionStatus.RECOVERY_PENDING,
        TransactionStatus.ROLLED_BACK
      ],
      [TransactionStatus.COMPLETED]: [],
      [TransactionStatus.FAILED]: [],
      [TransactionStatus.ROLLED_BACK]: [],
      [TransactionStatus.RECOVERY_PENDING]: [
        TransactionStatus.RECOVERY_IN_PROGRESS,
        TransactionStatus.FAILED
      ],
      [TransactionStatus.RECOVERY_IN_PROGRESS]: [
        TransactionStatus.COMPLETED,
        TransactionStatus.FAILED
      ]
    };

    if (currentState === newState) {
      return; // No state change, always valid
    }

    if (!validTransitions[currentState]?.includes(newState)) {
      throw errorHandler.createError(
        `Invalid state transition from ${currentState} to ${newState}`,
        ErrorCode.TRANSACTION_INVALID_STATE,
        { currentState, newState }
      );
    }
  }

  private isTerminalState(status: TransactionStatus): boolean {
    return [
      TransactionStatus.COMPLETED,
      TransactionStatus.FAILED,
      TransactionStatus.ROLLED_BACK
    ].includes(status);
  }

  private async rollbackPayment(transaction: Transaction): Promise<void> {
    // Implement payment-specific rollback logic
    this.logger.info('Rolling back payment transaction', { transactionId: transaction.id });
    // Implementation depends on the payment provider logic
  }

  private async rollbackRefund(transaction: Transaction): Promise<void> {
    // Implement refund-specific rollback logic
    this.logger.info('Rolling back refund transaction', { transactionId: transaction.id });
    // Implementation depends on the payment provider logic
  }

  private async rollbackChargeback(transaction: Transaction): Promise<void> {
    // Implement chargeback-specific rollback logic
    this.logger.info('Rolling back chargeback transaction', { transactionId: transaction.id });
    // Implementation depends on the payment provider logic
  }

  private generateOperationId(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}
