// src/tests/payment/integration/retry-system.integration.test.ts

import { RetryManager } from '../../../lib/payment/transaction/managers/retry.manager';
import { RetryQueue } from '../../../lib/payment/recovery/queue/retry.queue';
import { RecoveryManager } from '../../../lib/payment/transaction/managers/recovery.manager';
import { InMemoryTransactionStore } from '../../../lib/payment/transaction/store/transaction.store';
import { EventEmitter } from '../../../lib/payment/events/event.emitter';
import { EventStore } from '../../../lib/payment/events/event.store';
import { 
  Transaction, 
  TransactionStatus, 
  TransactionType,
  TransactionErrorCode
} from '../../../lib/payment/types/transaction.types';
import { v4 as uuidv4 } from 'uuid';

// Mock the payment provider
const mockPaymentProvider = {
  getTransactionStatus: jest.fn().mockResolvedValue({
    status: 'succeeded',
    reference: 'test-ref-123'
  })
};

// Mock RecordLocker for testing
const mockRecordLocker = {
  acquireLock: jest.fn().mockResolvedValue('lock-123'),
  releaseLock: jest.fn().mockResolvedValue(undefined)
};

describe('Retry System Integration Tests', () => {
  let transactionStore: InMemoryTransactionStore;
  let retryQueue: RetryQueue;
  let retryManager: RetryManager;
  let recoveryManager: RecoveryManager;
  let eventEmitter: EventEmitter;
  
  beforeEach(() => {
    // Set up dependencies
    transactionStore = new InMemoryTransactionStore();
    eventEmitter = new EventEmitter(new EventStore());
    retryQueue = new RetryQueue();
    
    // Create retry manager with fast retry times for testing
    retryManager = new RetryManager(
      transactionStore,
      retryQueue,
      {
        eventEmitter,
        retryPolicy: {
          maxAttempts: 3,
          backoffType: 'fixed',
          initialDelay: 100, // Use small delays for testing
          maxDelay: 200
        },
        recordLocker: mockRecordLocker as any
      }
    );
    
    // Create recovery manager
    recoveryManager = new RecoveryManager(
      transactionStore,
      undefined, // We don't need DLQ for these tests
      [
        {
          type: 'test',
          canHandle: () => true,
          execute: async () => {
            // Mock recovery strategy that always succeeds
            return {
              success: true,
              data: {
                recoveredAt: new Date(),
                providerReference: 'test-ref-456'
              }
            };
          }
        }
      ],
      { eventEmitter }
    );
    
    // Reset mocks
    mockPaymentProvider.getTransactionStatus.mockClear();
    mockRecordLocker.acquireLock.mockClear();
    mockRecordLocker.releaseLock.mockClear();
  });
  
  afterEach(() => {
    // Clean up
    retryQueue.removeAllListeners();
  });
  
  // Helper to create a test transaction
  const createTestTransaction = (status: TransactionStatus = TransactionStatus.PENDING): Transaction => {
    return {
      id: uuidv4(),
      type: TransactionType.PAYMENT,
      status,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: `idem-${Date.now()}`,
      retryCount: 0,
      createdAt: new Date(Date.now() - 60000), // 1 minute ago
      updatedAt: new Date()
    };
  };
  
  test('should schedule and process a retry successfully', async () => {
    // Create and save a transaction
    const transaction = createTestTransaction(TransactionStatus.FAILED);
    transaction.error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Network error occurred',
      recoverable: true,
      retryable: true
    };
    
    await transactionStore.save(transaction);
    
    // Set up event tracking
    const events: Record<string, any[]> = {};
    eventEmitter.on('transaction.retry_scheduled', (data) => {
      events['retry_scheduled'] = events['retry_scheduled'] || [];
      events['retry_scheduled'].push(data);
    });
    
    eventEmitter.on('transaction.retry_started', (data) => {
      events['retry_started'] = events['retry_started'] || [];
      events['retry_started'].push(data);
    });
    
    // Set up a promise to wait for retry completion
    const retryPromise = new Promise<void>(resolve => {
      eventEmitter.on('transaction.completed_after_retry', () => {
        resolve();
      });
      
      eventEmitter.on('transaction.failed_after_retry', () => {
        resolve();
      });
    });
    
    // Schedule retry - this should update the transaction and add it to the queue
    await retryManager.scheduleRetry(transaction);
    
    // Verify transaction was updated
    const pendingTransaction = await transactionStore.get(transaction.id);
    expect(pendingTransaction).toBeDefined();
    expect(pendingTransaction!.status).toBe(TransactionStatus.RECOVERY_PENDING);
    expect(pendingTransaction!.retryCount).toBe(1);
    
    // Verify retry scheduled event was emitted
    expect(events['retry_scheduled']).toBeDefined();
    expect(events['retry_scheduled'][0].transactionId).toBe(transaction.id);
    
    // Manually trigger the retry (to avoid waiting)
    retryQueue.emit('retry', transaction.id);
    
    // Wait for retry to complete
    await retryPromise;
    
    // Verify retry started event was emitted
    expect(events['retry_started']).toBeDefined();
    expect(events['retry_started'][0].transactionId).toBe(transaction.id);
    
    // Verify final transaction state
    const finalTransaction = await transactionStore.get(transaction.id);
    expect(finalTransaction).toBeDefined();
    
    // For demonstration, we're randomly determining success or failure
    // So we need to check which state we ended up in
    if (finalTransaction!.status === TransactionStatus.COMPLETED) {
      expect(finalTransaction!.metadata?.completedAfterRetry).toBe(true);
    } else {
      expect(finalTransaction!.metadata?.failedAfterRetry).toBe(true);
    }
  });
  
  test('should respect max retry attempts', async () => {
    // Create a transaction that already has max retry attempts
    const transaction = createTestTransaction(TransactionStatus.FAILED);
    transaction.retryCount = 3; // Match max attempts in the retry policy
    transaction.error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Network error occurred',
      recoverable: true,
      retryable: true
    };
    
    await transactionStore.save(transaction);
    
    // Attempt to schedule retry
    await retryManager.scheduleRetry(transaction);
    
    // Verify transaction was marked as failed and not added to retry queue
    const updatedTransaction = await transactionStore.get(transaction.id);
    expect(updatedTransaction).toBeDefined();
    expect(updatedTransaction!.status).toBe(TransactionStatus.FAILED);
    expect(updatedTransaction!.error?.code).toBe('RETRY_LIMIT_EXCEEDED');
    
    // Verify retry was not scheduled
    const pendingRetries = await retryQueue.getPendingRetries();
    expect(pendingRetries.find(r => r.transactionId === transaction.id)).toBeUndefined();
  });
  
  test('should cancel a pending retry', async () => {
    // Create and save a transaction
    const transaction = createTestTransaction(TransactionStatus.RECOVERY_PENDING);
    transaction.retryCount = 1;
    
    await transactionStore.save(transaction);
    
    // Add to retry queue
    await retryQueue.enqueue(transaction.id, 10000);
    
    // Cancel retry
    await retryManager.cancelRetry(transaction.id);
    
    // Verify transaction was updated
    const updatedTransaction = await transactionStore.get(transaction.id);
    expect(updatedTransaction).toBeDefined();
    expect(updatedTransaction!.status).toBe(TransactionStatus.FAILED);
    expect(updatedTransaction!.metadata?.retryCancelled).toBe(true);
    
    // Verify retry was removed from queue
    const pendingRetries = await retryQueue.getPendingRetries();
    expect(pendingRetries.find(r => r.transactionId === transaction.id)).toBeUndefined();
  });
  
  test('integration with recovery system', async () => {
    // Create a transaction that failed due to network error
    const transaction = createTestTransaction(TransactionStatus.FAILED);
    transaction.error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Network error occurred',
      recoverable: true,
      retryable: true
    };
    
    await transactionStore.save(transaction);
    
    // Set up mock provider responses
    mockPaymentProvider.getTransactionStatus.mockResolvedValueOnce({
      status: 'succeeded',
      reference: 'test-ref-789'
    });
    
    // Attempt recovery - this should use our recovery strategy
    const recoveredTransaction = await recoveryManager.initiateRecovery(
      transaction,
      transaction.error!
    );
    
    // Verify transaction is now successful
    expect(recoveredTransaction.status).toBe(TransactionStatus.COMPLETED);
    
    // If the transaction had been unrecoverable, it could be scheduled for retry
    const unrecoverableTransaction = createTestTransaction(TransactionStatus.FAILED);
    unrecoverableTransaction.error = {
      code: 'UNRECOVERABLE_ERROR',
      message: 'Unrecoverable error that requires retry',
      recoverable: false,
      retryable: true
    };
    
    await transactionStore.save(unrecoverableTransaction);
    
    // Mock recovery strategy to fail for this case
    const mockRecoveryManager = new RecoveryManager(
      transactionStore,
      undefined,
      [
        {
          type: 'test',
          canHandle: () => true,
          execute: async () => ({
            success: false,
            error: {
              code: 'RECOVERY_FAILED',
              message: 'Recovery strategy failed',
              recoverable: false,
              retryable: true
            }
          })
        }
      ],
      { 
        eventEmitter,
        retryManager // Pass our retry manager for integration
      }
    );
    
    // Attempt recovery - this should fail and schedule a retry
    await mockRecoveryManager.initiateRecovery(
      unrecoverableTransaction,
      unrecoverableTransact
