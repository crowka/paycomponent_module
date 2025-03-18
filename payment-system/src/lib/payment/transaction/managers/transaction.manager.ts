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

export class TransactionManager {
  private logger: PaymentLogger;

  constructor(
    private store: TransactionStore,
    private idempotencyManager: IdempotencyManager,
    private retryManager: RetryManager,
    private recoveryManager: RecoveryManager
  ) {
    this.logger = new PaymentLogger('info', 'TransactionManager');
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
    try {
      this.logger.info('Beginning transaction', { 
        type, 
        customerId: data.customerId,
        amount: data.amount,
        currency: data.currency
      });

      // Check for existing transaction with the same idempotency key
      const existingTransaction = await this.store.findByIdempotencyKey(data.idempotencyKey);
      if (existingTransaction) {
        this.logger.info('Found existing transaction with idempotency key', { 
          idempotencyKey: data.idempotencyKey,
          transactionId: existingTransaction.id
        });
        return existingTransaction;
      }

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
      
      this.logger.info('Transaction created', { 
        transactionId: transaction.id, 
        status: transaction.status 
      });
      
      return transaction;
    } catch (error) {
      if (error.message === 'Duplicate request') {
        throw errorHandler.createError(
          'Duplicate transaction request',
          ErrorCode.DUPLICATE_REQUEST,
          { idempotencyKey: data.idempotencyKey }
        );
      }
      
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
    try {
      this.logger.info('Updating transaction status', { 
        transactionId, 
        newStatus: status 
      });
      
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
      
      this.logger.info('Transaction status updated', { 
        transactionId, 
        oldStatus: transaction.status,
        newStatus: status 
      });
      
      // Handle idempotency key release if transaction is in terminal state
      if (this.isTerminalState(status)) {
        await this.idempotencyManager.releaseLock(transaction.idempotencyKey);
        this.logger.debug('Released idempotency lock', { 
          transactionId, 
          idempotencyKey: transaction.idempotencyKey 
        });
      }
      
      return updatedTransaction;
    } catch (error) {
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
    try {
      this.logger.info('Handling transaction error', { 
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
        this.logger.info('Scheduling transaction retry', { 
          transactionId, 
          retryCount: transaction.retryCount 
        });
        return this.retryManager.scheduleRetry(transaction);
      }

      // Handle recoverable errors
      if (error.recoverable) {
        this.logger.info('Initiating transaction recovery', { transactionId });
        return this.recoveryManager.initiateRecovery(transaction, error);
      }

      // Handle terminal errors
      this.logger.info('Marking transaction as failed', { 
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
      throw errorHandler.wrapError(
        error,
        'Failed to handle transaction error',
        ErrorCode.INTERNAL_ERROR,
        { transactionId }
      );
    }
  }

  async rollbackTransaction(transactionId: string): Promise<Transaction> {
    try {
      this.logger.info('Rolling back transaction', { transactionId });
      
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
}
