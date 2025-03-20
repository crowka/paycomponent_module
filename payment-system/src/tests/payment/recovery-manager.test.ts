// src/tests/payment/recovery-manager.test.ts
import { RecoveryManager } from '../../lib/payment/transaction/managers/recovery.manager';
import { DeadLetterQueue } from '../../lib/payment/recovery/queue/dead-letter.queue';
import { RecoveryStrategyFactory } from '../../lib/payment/recovery/strategies/strategy.factory';
import { InMemoryTransactionStore } from '../../lib/payment/transaction/store/transaction.store';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { EventStore } from '../../lib/payment/events/event.store';
import { 
  Transaction, 
  TransactionStatus, 
  TransactionType,
  TransactionErrorCode
} from '../../lib/payment/types/transaction.types';
import { v4 as uuidv4 } from 'uuid';

// Mock RecoveryStrategy implementation
const createMockStrategy = (canHandleResult: boolean, executeResult: {success: boolean}) => {
  return {
    type: 'mock',
    canHandle: jest.fn().mockReturnValue(canHandleResult),
    execute: jest.fn().mockResolvedValue(executeResult)
  };
};

describe('RecoveryManager', () => {
  let transactionStore: InMemoryTransactionStore;
  let deadLetterQueue: DeadLetterQueue;
  let eventEmitter: EventEmitter;
  let recoveryManager: RecoveryManager;
  
  beforeEach(() => {
    // Set up dependencies
    transactionStore = new InMemoryTransactionStore();
    eventEmitter = new EventEmitter(new EventStore());
    deadLetterQueue = new DeadLetterQueue({ eventEmitter });
    
    // Create mock strategies
    const mockStrategies = [
      createMockStrategy(false, {success: false}), // Won't handle any error
      createMockStrategy(true, {success: true})    // Will handle and succeed
    ];
    
    // Create recovery manager
    recoveryManager = new RecoveryManager(
      transactionStore,
      deadLetterQueue,
      mockStrategies,
      { eventEmitter }
    );
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
  
  test('should recover a transaction successfully', async () => {
    // Create and save a transaction
    const transaction = createTestTransaction();
    await transactionStore.save(transaction);
    
    // Set up mock error
    const error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Network error occurred',
      recoverable: true,
      retryable: true
    };
    
    // Set up mock event emission tracking
    const emittedEvents: Record<string, any[]> = {};
    eventEmitter.on('transaction.recovery_started', (data) => {
      emittedEvents['recovery_started'] = emittedEvents['recovery_started'] || [];
      emittedEvents['recovery_started'].push(data);
    });
    
    eventEmitter.on('transaction.recovery_completed', (data) => {
      emittedEvents['recovery_completed'] = emittedEvents['recovery_completed'] || [];
      emittedEvents['recovery_completed'].push(data);
    });
    
    // Attempt recovery
    const recoveredTransaction = await recoveryManager.initiateRecovery(transaction, error);
    
    // Verify transaction status is updated
    expect(recoveredTransaction.status).toBe(TransactionStatus.COMPLETED);
    expect(recoveredTransaction.metadata?.recoveredAt).toBeDefined();
    
    // Verify events were emitted
    expect(emittedEvents['recovery_started']).toBeDefined();
    expect(emittedEvents['recovery_started'][0].transactionId).toBe(transaction.id);
    
    expect(emittedEvents['recovery_completed']).toBeDefined();
    expect(emittedEvents['recovery_completed'][0].transactionId).toBe(transaction.id);
    
    // Verify the second strategy was used (the one that returns success)
    expect(recoveryManager['strategies'][1].execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: transaction.id })
    );
  });
  
  test('should move transaction to DLQ when recovery fails', async () => {
    // Create and save a transaction
    const transaction = createTestTransaction();
    await transactionStore.save(transaction);
    
    // Set up mock strategies that all fail
    const failingStrategies = [
      createMockStrategy(true, {
        success: false,
        error: {
          code: 'RECOVERY_FAILED',
          message: 'Recovery failed',
          recoverable: false,
          retryable: false
        }
      })
    ];
    
    // Create recovery manager with failing strategies
    const failingRecoveryManager = new RecoveryManager(
      transactionStore,
      deadLetterQueue,
      failingStrategies,
      { eventEmitter }
    );
    
    // Set up mock error
    const error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Network error occurred',
      recoverable: true,
      retryable: true
    };
    
    // Set up mock event emission tracking
    const emittedEvents: Record<string, any[]> = {};
    eventEmitter.on('transaction.moved_to_dlq', (data) => {
      emittedEvents['moved_to_dlq'] = emittedEvents['moved_to_dlq'] || [];
      emittedEvents['moved_to_dlq'].push(data);
    });
    
    // Attempt recovery
    const failedTransaction = await failingRecoveryManager.initiateRecovery(transaction, error);
    
    // Verify transaction status is updated to FAILED
    expect(failedTransaction.status).toBe(TransactionStatus.FAILED);
    expect(failedTransaction.error).toBeDefined();
    expect(failedTransaction.error!.code).toBe('RECOVERY_FAILED');
    
    // Verify transaction was moved to DLQ
    const dlqTransactions = await deadLetterQueue.getAll();
    expect(dlqTransactions.length).toBe(1);
    expect(dlqTransactions[0].id).toBe(transaction.id);
    
    // Verify events were emitted
    expect(emittedEvents['moved_to_dlq']).toBeDefined();
    expect(emittedEvents['moved_to_dlq'][0].transactionId).toBe(transaction.id);
  });
  
  test('should not recover transaction in invalid state', async () => {
    // Create a transaction that's already completed
    const completedTransaction = createTestTransaction(TransactionStatus.COMPLETED);
    await transactionStore.save(completedTransaction);
    
    // Set up mock error
    const error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Network error occurred',
      recoverable: true,
      retryable: true
    };
    
    // Attempt recovery should throw
    await expect(
      recoveryManager.initiateRecovery(completedTransaction, error)
    ).rejects.toThrow(/Cannot recover transaction in COMPLETED state/);
  });
  
  test('should reprocess transaction from DLQ', async () => {
    // Create and save a failed transaction
    const failedTransaction = createTestTransaction(TransactionStatus.FAILED);
    failedTransaction.error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Network error occurred',
      recoverable: true,
      retryable: true
    };
    await transactionStore.save(failedTransaction);
    
    // Add to DLQ
    await deadLetterQueue.enqueue(failedTransaction);
    
    // Set up mock event emission tracking
    const emittedEvents: Record<string, any[]> = {};
    eventEmitter.on('transaction.reprocessing', (data) => {
      emittedEvents['reprocessing'] = emittedEvents['reprocessing'] || [];
      emittedEvents['reprocessing'].push(data);
    });
    
    // Reprocess from DLQ
    const reprocessedTransaction = await recoveryManager.reprocessFromDeadLetter(failedTransaction.id);
    
    // Verify transaction status is updated
    expect(reprocessedTransaction.status).toBe(TransactionStatus.COMPLETED);
    
    // Verify events were emitted
    expect(emittedEvents['reprocessing']).toBeDefined();
    expect(emittedEvents['reprocessing'][0].transactionId).toBe(failedTransaction.id);
    
    // Verify transaction was removed from DLQ
    const dlqTransactions = await deadLetterQueue.getAll();
    expect(dlqTransactions.length).toBe(0);
  });
  
  test('should get dead letter queue stats', async () => {
    // Create and save multiple failed transactions with different errors
    const transaction1 = createTestTransaction(TransactionStatus.FAILED);
    transaction1.error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Network error',
      recoverable: true,
      retryable: true
    };
    
    const transaction2 = createTestTransaction(TransactionStatus.FAILED);
    transaction2.error = {
      code: TransactionErrorCode.TIMEOUT,
      message: 'Timeout error',
      recoverable: true,
      retryable: true
    };
    
    const transaction3 = createTestTransaction(TransactionStatus.FAILED);
    transaction3.error = {
      code: TransactionErrorCode.NETWORK_ERROR,
      message: 'Another network error',
      recoverable: true,
      retryable: true
    };
    
    // Save transactions
    await transactionStore.save(transaction1);
    await transactionStore.save(transaction2);
    await transactionStore.save(transaction3);
    
    // Add to DLQ
    await deadLetterQueue.enqueue(transaction1);
    await deadLetterQueue.enqueue(transaction2);
    await deadLetterQueue.enqueue(transaction3);
    
    // Get stats
    const stats = await recoveryManager.getDeadLetterQueueStats();
    
    // Verify statistics
    expect(stats.total).toBe(3);
    expect(stats[TransactionErrorCode.NETWORK_ERROR]).toBe(2);
    expect(stats[TransactionErrorCode.TIMEOUT]).toBe(1);
  });
});
