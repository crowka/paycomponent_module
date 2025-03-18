// src/lib/payment/transaction/utils/compensating-transaction.ts
import { v4 as uuidv4 } from 'uuid';
import { PaymentLogger } from '../../utils/logger';
import { errorHandler, ErrorCode } from '../../utils/error';
import { TransactionStore } from '../store/transaction.store';
import { Transaction, TransactionStatus, TransactionType } from '../types';
import { EventEmitter } from '../../events/event.emitter';
import { RecordLocker } from '../../utils/record-locker';

export interface CompensatingOperation {
  id: string;
  transactionId: string;
  operationType: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  params: Record<string, any>;
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface CompensatingTransactionOptions {
  eventEmitter?: EventEmitter;
  recordLocker?: RecordLocker;
}

/**
 * Handles compensating transactions for rollback scenarios
 * to ensure data consistency when operations fail
 */
export class CompensatingTransactionHandler {
  private logger: PaymentLogger;
  private operations: Map<string, CompensatingOperation> = new Map();
  private eventEmitter?: EventEmitter;
  private recordLocker?: RecordLocker;
  
  constructor(
    private store: TransactionStore,
    options: CompensatingTransactionOptions = {}
  ) {
    this.logger = new PaymentLogger('info', 'CompensatingTransactionHandler');
    this.eventEmitter = options.eventEmitter;
    this.recordLocker = options.recordLocker;
  }
  
  /**
   * Register a compensating operation for a transaction
   * This should be called before performing the original operation
   */
  async registerCompensatingOperation(
    transactionId: string,
    operationType: string,
    params: Record<string, any>
  ): Promise<string> {
    const operationId = uuidv4();
    const now = new Date();
    
    const operation: CompensatingOperation = {
      id: operationId,
      transactionId,
      operationType,
      status: 'pending',
      params,
      createdAt: now,
      updatedAt: now
    };
    
    this.operations.set(operationId, operation);
    
    this.logger.debug(`Registered compensating operation for transaction ${transactionId}`, {
      operationId,
      operationType
    });
    
    // Emit event
    if (this.eventEmitter) {
      this.eventEmitter.emit('transaction.compensating_registered', {
        transactionId,
        operationId,
        operationType
      }).catch(error => {
        this.logger.error('Failed to emit compensating registration event', { error });
      });
    }
    
    return operationId;
  }
  
  /**
   * Execute a compensating transaction for a failed transaction
   */
  async executeCompensatingTransaction(
    transactionId: string
  ): Promise<boolean> {
    let lockId: string | undefined;
    
    try {
      // Acquire lock on transaction
      if (this.recordLocker) {
        lockId = await this.recordLocker.acquireLock(
          transactionId,
          'transaction',
          { waitTimeoutMs: 10000 } // Wait up to 10 seconds
        );
      }
      
      // Get the transaction
      const transaction = await this.store.get(transactionId);
      if (!transaction) {
        throw errorHandler.createError(
          `Transaction not found: ${transactionId}`,
          ErrorCode.TRANSACTION_NOT_FOUND,
          { transactionId }
        );
      }
      
      // Check if transaction is already in a terminal state
      if (this.isTerminalState(transaction.status)) {
        this.logger.info(`Transaction ${transactionId} already in terminal state ${transaction.status}, skipping compensation`);
        return true;
      }
      
      // Log the compensation start
      this.logger.info(`Executing compensating transaction for ${transactionId}`, {
        currentStatus: transaction.status
      });
      
      // Find all compensating operations for this transaction
      const operations = Array.from(this.operations.values())
        .filter(op => op.transactionId === transactionId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Execute in reverse order
      
      if (operations.length === 0) {
        this.logger.warn(`No compensating operations found for transaction ${transactionId}`);
        return false;
      }
      
      // Execute each compensating operation
      for (const operation of operations) {
        await this.executeCompensatingOperation(operation);
      }
      
      // Update transaction status
      await this.store.save({
        ...transaction,
        status: TransactionStatus.ROLLED_BACK,
        updatedAt: new Date()
      });
      
      this.logger.info(`Successfully executed compensating transaction for ${transactionId}`);
      
      // Emit event
      if (this.eventEmitter) {
        this.eventEmitter.emit('transaction.compensated', {
          transactionId,
          operationCount: operations.length
        }).catch(error => {
          this.logger.error('Failed to emit transaction compensated event', { error });
        });
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to execute compensating transaction for ${transactionId}`, { error });
      
      // Emit failure event
      if (this.eventEmitter) {
        this.eventEmitter.emit('transaction.compensation_failed', {
          transactionId,
          error: error.message
        }).catch(errEvent => {
          this.logger.error('Failed to emit compensation failure event', { error: errEvent });
        });
      }
      
      return false;
    } finally {
      // Release lock
      if (this.recordLocker && lockId) {
        await this.recordLocker.releaseLock(transactionId, 'transaction', lockId);
      }
    }
  }
  
  /**
   * Execute a single compensating operation
   */
  private async executeCompensatingOperation(
    operation: CompensatingOperation
  ): Promise<void> {
    try {
      // Update status to executing
      operation.status = 'executing';
      operation.updatedAt = new Date();
      
      this.logger.debug(`Executing compensating operation ${operation.id}`, {
        transactionId: operation.transactionId,
        operationType: operation.operationType
      });
      
      // Execute the appropriate compensation based on operation type
      switch (operation.operationType) {
        case 'payment.authorize':
          await this.compensatePaymentAuthorization(operation);
          break;
        case 'payment.capture':
          await this.compensatePaymentCapture(operation);
          break;
        case 'refund.initiate':
          await this.compensateRefundInitiation(operation);
          break;
        case 'customer.update':
          await this.compensateCustomerUpdate(operation);
          break;
        default:
          throw new Error(`Unsupported operation type: ${operation.operationType}`);
      }
      
      // Update status to completed
      operation.status = 'completed';
      operation.completedAt = new Date();
      operation.updatedAt = new Date();
      
      this.logger.debug(`Completed compensating operation ${operation.id}`);
    } catch (error) {
      // Mark operation as failed
      operation.status = 'failed';
      operation.error = error.message;
      operation.updatedAt = new Date();
      
      this.logger.error(`Failed to execute compensating operation ${operation.id}`, { 
        error,
        transactionId: operation.transactionId,
        operationType: operation.operationType
      });
      
      // Re-throw to fail the entire compensation
      throw error;
    }
  }
  
  /**
   * Compensate for a payment authorization
   */
  private async compensatePaymentAuthorization(
    operation: CompensatingOperation
  ): Promise<void> {
    // Implementation would call payment provider to void authorization
    this.logger.info(`Compensating payment authorization`, {
      transactionId: operation.transactionId,
      authorizationId: operation.params.authorizationId
    });
    
    // Simulated implementation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    operation.result = { 
      success: true,
      voidedAt: new Date()
    };
  }
  
  /**
   * Compensate for a payment capture
   */
  private async compensatePaymentCapture(
    operation: CompensatingOperation
  ): Promise<void> {
    // Implementation would call payment provider to refund capture
    this.logger.info(`Compensating payment capture`, {
      transactionId: operation.transactionId,
      captureId: operation.params.captureId,
      amount: operation.params.amount
    });
    
    // Simulated implementation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    operation.result = { 
      success: true,
      refundId: uuidv4(),
      refundedAt: new Date()
    };
  }
  
  /**
   * Compensate for a refund initiation
   */
  private async compensateRefundInitiation(
    operation: CompensatingOperation
  ): Promise<void> {
    // Implementation would call payment provider to cancel refund
    this.logger.info(`Compensating refund initiation`, {
      transactionId: operation.transactionId,
      refundId: operation.params.refundId
    });
    
    // Simulated implementation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    operation.result = { 
      success: true,
      cancelledAt: new Date()
    };
  }
  
  /**
   * Compensate for a customer update
   */
  private async compensateCustomerUpdate(
    operation: CompensatingOperation
  ): Promise<void> {
    // Implementation would restore previous customer state
    this.logger.info(`Compensating customer update`, {
      transactionId: operation.transactionId,
      customerId: operation.params.customerId,
      previousState: operation.params.previousState
    });
    
    // Simulated implementation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    operation.result = { 
      success: true,
      restoredAt: new Date()
    };
  }
  
  /**
   * Check if transaction status is terminal
   */
  private isTerminalState(status: TransactionStatus): boolean {
    return [
      TransactionStatus.COMPLETED,
      TransactionStatus.FAILED,
      TransactionStatus.ROLLED_BACK
    ].includes(status);
  }
}
