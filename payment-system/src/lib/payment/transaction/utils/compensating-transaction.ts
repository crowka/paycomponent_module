// src/lib/payment/transaction/utils/compensating-transaction.ts
import { v4 as uuidv4 } from 'uuid';
import { PaymentLogger } from '../../utils/logger';
import { errorHandler, ErrorCode } from '../../utils/error';
import { TransactionStore } from '../store/transaction.store';
import { Transaction, TransactionStatus, TransactionType } from '../types';
import { EventEmitter } from '../../events/event.emitter';
import { RecordLocker, LockLevel } from '../../utils/record-locker';

export enum CompensatingOperationStatus {
  PENDING = 'pending',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped'
}

export enum CompensatingOperationType {
  PAYMENT_AUTHORIZE = 'payment.authorize',
  PAYMENT_CAPTURE = 'payment.capture',
  PAYMENT_VOID = 'payment.void',
  REFUND_INITIATE = 'refund.initiate',
  REFUND_CANCEL = 'refund.cancel',
  CUSTOMER_UPDATE = 'customer.update',
  INVENTORY_RESERVE = 'inventory.reserve',
  INVENTORY_RELEASE = 'inventory.release',
  NOTIFICATION_SEND = 'notification.send'
}

export interface CompensatingOperation {
  id: string;
  transactionId: string;
  operationType: CompensatingOperationType | string;
  status: CompensatingOperationStatus;
  params: Record<string, any>;
  originalState?: any;
  executionOrder: number;
  result?: any;
  error?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  dependencies?: string[]; // IDs of operations that must complete before this one
}

export interface CompensatingTransactionOptions {
  eventEmitter?: EventEmitter;
  recordLocker?: RecordLocker;
  maxRetries?: number;
  lockTimeoutMs?: number;
}

export interface RegisterOperationParams {
  operationType: CompensatingOperationType | string;
  params: Record<string, any>;
  originalState?: any;
  executionOrder?: number;
  maxRetries?: number;
  dependencies?: string[];
}

/**
 * Handles compensating transactions for rollback scenarios
 * to ensure data consistency when operations fail
 */
export class CompensatingTransactionHandler {
  private logger: PaymentLogger;
  private operations: Map<string, CompensatingOperation> = new Map();
  private transactionOperations: Map<string, Set<string>> = new Map(); // transactionId -> Set<operationId>
  private eventEmitter?: EventEmitter;
  private recordLocker?: RecordLocker;
  private defaultMaxRetries: number;
  private lockTimeoutMs: number;
  
  constructor(
    private store: TransactionStore,
    options: CompensatingTransactionOptions = {}
  ) {
    this.logger = new PaymentLogger('info', 'CompensatingTransactionHandler');
    this.eventEmitter = options.eventEmitter;
    this.recordLocker = options.recordLocker;
    this.defaultMaxRetries = options.maxRetries || 3;
    this.lockTimeoutMs = options.lockTimeoutMs || 10000;
  }
  
  /**
   * Register a compensating operation for a transaction
   * This should be called before performing the original operation
   */
  async registerCompensatingOperation(
    transactionId: string,
    params: RegisterOperationParams
  ): Promise<string> {
    const operationId = uuidv4();
    const now = new Date();
    
    const operation: CompensatingOperation = {
      id: operationId,
      transactionId,
      operationType: params.operationType,
      status: CompensatingOperationStatus.PENDING,
      params: params.params,
      originalState: params.originalState,
      executionOrder: params.executionOrder || 0,
      retryCount: 0,
      maxRetries: params.maxRetries || this.defaultMaxRetries,
      dependencies: params.dependencies,
      createdAt: now,
      updatedAt: now
    };
    
    this.operations.set(operationId, operation);
    
    // Track operations by transaction
    if (!this.transactionOperations.has(transactionId)) {
      this.transactionOperations.set(transactionId, new Set());
    }
    this.transactionOperations.get(transactionId)!.add(operationId);
    
    this.logger.debug(`Registered compensating operation for transaction ${transactionId}`, {
      operationId,
      operationType: params.operationType,
      executionOrder: operation.executionOrder
    });
    
    // Emit event
    if (this.eventEmitter) {
      this.eventEmitter.emit('transaction.compensating_registered', {
        transactionId,
        operationId,
        operationType: params.operationType,
        executionOrder: operation.executionOrder
      }).catch(error => {
        this.logger.error('Failed to emit compensating registration event', { error });
      });
    }
    
    return operationId;
  }
  
  /**
   * Execute a compensating transaction for a failed transaction
   * This will execute all registered compensation operations in reverse order
   */
  async executeCompensatingTransaction(
    transactionId: string
  ): Promise<boolean> {
    let lockId: string | undefined;
    
    try {
      // Acquire lock on transaction if locker is available
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
        } catch (error) {
          this.logger.error(`Failed to acquire lock for transaction ${transactionId}`, { error });
          // Continue without lock as this is a recovery operation
        }
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
        currentStatus: transaction.status,
        transactionType: transaction.type
      });
      
      // Find all compensating operations for this transaction
      const operationIds = this.transactionOperations.get(transactionId);
      if (!operationIds || operationIds.size === 0) {
        this.logger.warn(`No compensating operations found for transaction ${transactionId}`);
        
        // If no operations but transaction exists, mark as rolled back anyway
        await this.store.save({
          ...transaction,
          status: TransactionStatus.ROLLED_BACK,
          updatedAt: new Date()
        });
        
        return true;
      }
      
      // Get all operations and sort by execution order (descending)
      const operations: CompensatingOperation[] = [];
      for (const opId of operationIds) {
        const operation = this.operations.get(opId);
        if (operation) {
          operations.push(operation);
        }
      }
      
      // Sort by execution order (highest first for reverse execution)
      operations.sort((a, b) => b.executionOrder - a.executionOrder);
      
      // Build dependency graph for operations
      const dependencyGraph = this.buildDependencyGraph(operations);
      
      // Execute operations in correct dependency order
      const executionSuccess = await this.executeOperationsWithDependencies(dependencyGraph);
      
      if (executionSuccess) {
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
      } else {
        this.logger.error(`Failed to complete all compensating operations for ${transactionId}`);
        
        // Emit partial failure event
        if (this.eventEmitter) {
          this.eventEmitter.emit('transaction.compensation_partial', {
            transactionId,
            completedOperations: operations.filter(
              op => op.status === CompensatingOperationStatus.COMPLETED
            ).length,
            failedOperations: operations.filter(
              op => op.status === CompensatingOperationStatus.FAILED
            ).length
          }).catch(error => {
            this.logger.error('Failed to emit partial compensation event', { error });
          });
        }
        
        return false;
      }
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
        try {
          await this.recordLocker.releaseLock(transactionId, 'transaction', lockId);
        } catch (error) {
          this.logger.error(`Failed to release lock for transaction ${transactionId}`, { error });
        }
      }
    }
  }
  
  /**
   * Build dependency graph for operations
   */
  private buildDependencyGraph(operations: CompensatingOperation[]): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    
    // Initialize graph
    for (const op of operations) {
      graph.set(op.id, new Set());
    }
    
    // Add dependencies
    for (const op of operations) {
      if (op.dependencies && op.dependencies.length > 0) {
        for (const depId of op.dependencies) {
          // If the dependency exists in our operations
          if (graph.has(depId)) {
            // Add a reverse dependency (depId depends on op.id in compensation)
            const dependents = graph.get(depId) || new Set();
            dependents.add(op.id);
            graph.set(depId, dependents);
          }
        }
      }
    }
    
    return graph;
  }
  
  /**
   * Execute operations respecting dependencies
   */
  private async executeOperationsWithDependencies(
    dependencyGraph: Map<string, Set<string>>
  ): Promise<boolean> {
    // Create copy of graph to work with
    const graph = new Map(dependencyGraph);
    const executed = new Set<string>();
    let allSuccessful = true;
    
    // Keep executing until no more operations can be executed
    while (graph.size > 0) {
      const readyOperations: string[] = [];
      
      // Find operations with no dependencies
      for (const [opId, dependencies] of graph.entries()) {
        if (dependencies.size === 0) {
          readyOperations.push(opId);
        }
      }
      
      // If no operations are ready, we have a cycle or all operations are done
      if (readyOperations.length === 0) {
        this.logger.warn('Dependency cycle detected in compensating operations');
        break;
      }
      
      // Execute ready operations in parallel
      const results = await Promise.all(
        readyOperations.map(opId => this.executeCompensatingOperation(opId))
      );
      
      // Process results
      for (let i = 0; i < readyOperations.length; i++) {
        const opId = readyOperations[i];
        const success = results[i];
        
        // Remove from graph
        graph.delete(opId);
        executed.add(opId);
        
        // Update dependencies
        if (success) {
          // Remove this operation as a dependency from others
          for (const dependencies of graph.values()) {
            dependencies.delete(opId);
          }
        } else {
          allSuccessful = false;
          
          // Mark dependent operations as skipped
          for (const [depOpId, dependencies] of graph.entries()) {
            if (dependencies.has(opId)) {
              const operation = this.operations.get(depOpId);
              if (operation) {
                operation.status = CompensatingOperationStatus.SKIPPED;
                operation.updatedAt = new Date();
                this.logger.warn(`Skipped dependent operation ${depOpId} due to failure of ${opId}`);
              }
            }
          }
        }
      }
    }
    
    return allSuccessful;
  }
  
  /**
   * Execute a single compensating operation
   */
  private async executeCompensatingOperation(
    operationId: string
  ): Promise<boolean> {
    const operation = this.operations.get(operationId);
    if (!operation) {
      this.logger.error(`Operation not found: ${operationId}`);
      return false;
    }
    
    try {
      // Update status to executing
      operation.status = CompensatingOperationStatus.EXECUTING;
      operation.updatedAt = new Date();
      
      this.logger.debug(`Executing compensating operation ${operation.id}`, {
        transactionId: operation.transactionId,
        operationType: operation.operationType
      });
      
      // Execute the appropriate compensation based on operation type
      let success = false;
      switch (operation.operationType) {
        case CompensatingOperationType.PAYMENT_AUTHORIZE:
          success = await this.compensatePaymentAuthorization(operation);
          break;
        case CompensatingOperationType.PAYMENT_CAPTURE:
          success = await this.compensatePaymentCapture(operation);
          break;
        case CompensatingOperationType.PAYMENT_VOID:
          success = await this.compensatePaymentVoid(operation);
          break;
        case CompensatingOperationType.REFUND_INITIATE:
          success = await this.compensateRefundInitiation(operation);
          break;
        case CompensatingOperationType.REFUND_CANCEL:
          success = await this.compensateRefundCancellation(operation);
          break;
        case CompensatingOperationType.CUSTOMER_UPDATE:
          success = await this.compensateCustomerUpdate(operation);
          break;
        case CompensatingOperationType.INVENTORY_RESERVE:
          success = await this.compensateInventoryReserve(operation);
          break;
        case CompensatingOperationType.INVENTORY_RELEASE:
          success = await this.compensateInventoryRelease(operation);
          break;
        case CompensatingOperationType.NOTIFICATION_SEND:
          success = await this.compensateNotificationSend(operation);
          break;
        default:
          this.logger.warn(`Unsupported operation type: ${operation.operationType}`);
          
          // For custom operation types, look for handler method
          const handlerMethod = `compensate${this.capitalize(operation.operationType.replace(/\./g, '_'))}`;
          if (typeof (this as any)[handlerMethod] === 'function') {
            success = await (this as any)[handlerMethod](operation);
          } else {
            throw new Error(`No compensation handler for operation type: ${operation.operationType}`);
          }
      }
      
      if (success) {
        // Update status to completed
        operation.status = CompensatingOperationStatus.COMPLETED;
        operation.completedAt = new Date();
        operation.updatedAt = new Date();
        
        this.logger.debug(`Completed compensating operation ${operation.id}`);
        
        // Emit operation completed event
        if (this.eventEmitter) {
          this.eventEmitter.emit('transaction.compensation_operation_completed', {
            operationId: operation.id,
            transactionId: operation.transactionId,
            operationType: operation.operationType
          }).catch(error => {
            this.logger.error('Failed to emit operation completed event', { error });
          });
        }
        
        return true;
      } else {
        throw new Error(`Compensation operation did not complete successfully`);
      }
    } catch (error) {
      // Retry logic
      operation.retryCount += 1;
      operation.error = error.message;
      operation.updatedAt = new Date();
      
      if (operation.retryCount < operation.maxRetries) {
        this.logger.warn(`Retrying compensating operation ${operation.id} (attempt ${operation.retryCount + 1}/${operation.maxRetries})`, {
          error: error.message,
          transactionId: operation.transactionId,
          operationType: operation.operationType
        });
        
        // Recursive retry with exponential backoff
        const delay = Math.min(100 * Math.pow(2, operation.retryCount), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return this.executeCompensatingOperation(operation.id);
      }
      
      // Mark operation as failed if max retries reached
      operation.status = CompensatingOperationStatus.FAILED;
      
      this.logger.error(`Failed to execute compensating operation ${operation.id} after ${operation.retryCount} retries`, { 
        error,
        transactionId: operation.transactionId,
        operationType: operation.operationType
      });
      
      // Emit operation failed event
      if (this.eventEmitter) {
        this.eventEmitter.emit('transaction.compensation_operation_failed', {
          operationId: operation.id,
          transactionId: operation.transactionId,
          operationType: operation.operationType,
          error: error.message,
          retries: operation.retryCount
        }).catch(errEvent => {
          this.logger.error('Failed to emit operation failed event', { error: errEvent });
        });
      }
      
      return false;
    }
  }
  
  /**
   * Compensate for a payment authorization
   */
  private async compensatePaymentAuthorization(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Implementation would call payment provider to void authorization
    this.logger.info(`Compensating payment authorization`, {
      transactionId: operation.transactionId,
      authorizationId: operation.params.authorizationId
    });
    
    try {
      // In a real implementation, this would call the payment provider
      // Simulated implementation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      operation.result = { 
        success: true,
        voidedAt: new Date()
      };
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to void authorization ${operation.params.authorizationId}`, { error });
      throw error;
    }
  }
  
  /**
   * Compensate for a payment capture
   */
  private async compensatePaymentCapture(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Implementation would call payment provider to refund capture
    this.logger.info(`Compensating payment capture`, {
      transactionId: operation.transactionId,
      captureId: operation.params.captureId,
      amount: operation.params.amount
    });
    
    try {
      // In a real implementation, this would call the payment provider
      // Simulated implementation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      operation.result = { 
        success: true,
        refundId: uuidv4(),
        refundedAt: new Date()
      };
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to refund capture ${operation.params.captureId}`, { error });
      throw error;
    }
  }
  
  /**
   * Compensate for a payment void
   */
  private async compensatePaymentVoid(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Typically can't undo a void, but we can log it
    this.logger.info(`Recording void compensation (no action needed)`, {
      transactionId: operation.transactionId,
      voidId: operation.params.voidId
    });
    
    // No actual action needed, just record
    operation.result = { 
      success: true,
      message: 'No action needed for void compensation'
    };
    
    return true;
  }
  
  /**
   * Compensate for a refund initiation
   */
  private async compensateRefundInitiation(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Implementation would call payment provider to cancel refund
    this.logger.info(`Compensating refund initiation`, {
      transactionId: operation.transactionId,
      refundId: operation.params.refundId
    });
    
    try {
      // In a real implementation, this would call the payment provider
      // Simulated implementation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      operation.result = { 
        success: true,
        cancelledAt: new Date()
      };
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel refund ${operation.params.refundId}`, { error });
      throw error;
    }
  }
  
  /**
   * Compensate for a refund cancellation
   */
  private async compensateRefundCancellation(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Implementation would reinitiate refund
    this.logger.info(`Compensating refund cancellation`, {
      transactionId: operation.transactionId,
      originalRefundId: operation.params.refundId
    });
    
    try {
      // In a real implementation, this would call the payment provider
      // Simulated implementation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      operation.result = { 
        success: true,
        newRefundId: uuidv4(),
        reinstatedAt: new Date()
      };
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to reinstate refund ${operation.params.refundId}`, { error });
      throw error;
    }
  }
  
  /**
   * Compensate for a customer update
   */
  private async compensateCustomerUpdate(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Implementation would restore previous customer state
    this.logger.info(`Compensating customer update`, {
      transactionId: operation.transactionId,
      customerId: operation.params.customerId
    });
    
    if (!operation.originalState) {
      this.logger.warn(`No original state available for customer ${operation.params.customerId}`);
      return false;
    }
    
    try {
      // In a real implementation, this would call the customer service
      // Simulated implementation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      operation.result = { 
        success: true,
        restoredAt: new Date()
      };
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to restore customer ${operation.params.customerId}`, { error });
      throw error;
    }
  }
  
  /**
   * Compensate for inventory reservation
   */
  private async compensateInventoryReserve(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Implementation would release inventory
    this.logger.info(`Compensating inventory reservation`, {
      transactionId: operation.transactionId,
      productId: operation.params.productId,
      quantity: operation.params.quantity
    });
    
    try {
      // In a real implementation, this would call the inventory service
      // Simulated implementation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      operation.result = { 
        success: true,
        releasedAt: new Date()
      };
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to release inventory for ${operation.params.productId}`, { error });
      throw error;
    }
  }
  
  /**
   * Compensate for inventory release
   */
  private async compensateInventoryRelease(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Implementation would re-reserve inventory
    this.logger.info(`Compensating inventory release`, {
      transactionId: operation.transactionId,
      productId: operation.params.productId,
      quantity: operation.params.quantity
    });
    
    try {
      // In a real implementation, this would call the inventory service
      // Simulated implementation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      operation.result = { 
        success: true,
        reservedAt: new Date()
      };
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to re-reserve inventory for ${operation.params.productId}`, { error });
      throw error;
    }
  }
  
  /**
   * Compensate for notification sending
   */
  private async compensateNotificationSend(
    operation: CompensatingOperation
  ): Promise<boolean> {
    // Implementation would send a follow-up notification
    this.logger.info(`Compensating notification`, {
      transactionId: operation.transactionId,
      notificationType: operation.params.type,
      recipient: operation.params.recipient
    });
    
    try {
      // In a real implementation, this would call the notification service
      // Simulated implementation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      operation.result = { 
        success: true,
        followUpSentAt: new Date()
      };
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to send follow-up notification to ${operation.params.recipient}`, { error });
      throw error;
    }
  }
  
  /**
   * Get all compensating operations for a transaction
   */
  getCompensatingOperations(transactionId: string): CompensatingOperation[] {
    const operationIds = this.transactionOperations.get(transactionId);
    if (!operationIds) {
      return [];
    }
    
    const operations: CompensatingOperation[] = [];
    for (const opId of operationIds) {
      const operation = this.operations.get(opId);
      if (operation) {
        operations.push({ ...operation });
      }
    }
    
    return operations;
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
  
  /**
   * Capitalize a string
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
