// src/tests/controllers/transaction.controller.test.ts

import { Request, Response } from 'express';
import { TransactionController } from '../../api/controllers/transaction.controller';
import { TransactionManager } from '../../lib/payment/transaction/managers/transaction.manager';
import { RetryManager } from '../../lib/payment/transaction/managers/retry.manager';
import { InMemoryTransactionStore } from '../../lib/payment/transaction/store/transaction.store';
import { RetryQueue } from '../../lib/payment/recovery/queue/retry.queue';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { EventStore } from '../../lib/payment/events/event.store';
import { 
  TransactionStatus, 
  TransactionType,
  TransactionErrorCode
} from '../../lib/payment/types/transaction.types';
import { v4 as uuidv4 } from 'uuid';

// Helper to create a mock express request
const mockRequest = (params: any = {}, body: any = {}, headers: any = {}) => {
  return {
    params,
    body,
    headers,
  } as Request;
};

// Helper to create a mock express response
const mockResponse = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('TransactionController', () => {
  let transactionController: TransactionController;
  let transactionManager: TransactionManager;
  let retryManager: RetryManager;
  let transactionStore: InMemoryTransactionStore;
  let retryQueue: RetryQueue;
  let eventEmitter: EventEmitter;
  
  beforeEach(() => {
    // Setup dependencies
    transactionStore = new InMemoryTransactionStore();
    eventEmitter = new EventEmitter(new EventStore());
    retryQueue = new RetryQueue();
    
    // Create retry manager
    retryManager = new RetryManager(
      transactionStore,
      retryQueue,
      {
        eventEmitter,
        retryPolicy: {
          maxAttempts: 3,
          backoffType: 'fixed',
          initialDelay: 100, // Small delays for testing
          maxDelay: 200
        }
      }
    );
    
    // Create transaction manager with mocked dependencies
    transactionManager = new TransactionManager(
      transactionStore,
      {
        eventEmitter,
        retryManager
      }
    );
    
    // Create controller
    transactionController = new TransactionController(
      transactionManager,
      retryManager
    );
    
    // Spy on logger methods to avoid console output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  
  afterEach(() => {
    // Restore console methods
    jest.restoreAllMocks();
    
    // Clean up
    retryQueue.removeAllListeners();
  });
  
  test('createTransaction should return a new transaction', async () => {
    // Arrange
    const req = mockRequest({}, {
      type: TransactionType.PAYMENT,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: 'idem-123'
    });
    
    const res = mockResponse();
    
    // Act
    await transactionController.createTransaction(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        transaction: expect.objectContaining({
          status: TransactionStatus.PENDING,
          amount: 100,
          currency: 'USD'
        })
      })
    );
  });
  
  test('getTransaction should return a transaction by ID', async () => {
    // Arrange
    const transaction = {
      id: uuidv4(),
      type: TransactionType.PAYMENT,
      status: TransactionStatus.PENDING,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: 'idem-123',
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await transactionStore.save(transaction);
    
    const req = mockRequest({ id: transaction.id });
    const res = mockResponse();
    
    // Track events for assertions
    const events: Record<string, any[]> = {};
    eventEmitter.on('transaction.retry_scheduled', (data) => {
      events['retry_scheduled'] = events['retry_scheduled'] || [];
      events['retry_scheduled'].push(data);
    });
    
    // Act
    await transactionController.retryTransaction(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        transaction: expect.objectContaining({
          id: transaction.id,
          status: TransactionStatus.RECOVERY_PENDING,
          retryCount: 1
        })
      })
    );
    
    // Verify retry was scheduled
    expect(events['retry_scheduled']).toBeDefined();
    expect(events['retry_scheduled'][0].transactionId).toBe(transaction.id);
    
    // Verify transaction was updated in store
    const updatedTransaction = await transactionStore.get(transaction.id);
    expect(updatedTransaction?.status).toBe(TransactionStatus.RECOVERY_PENDING);
    expect(updatedTransaction?.retryCount).toBe(1);
  });
  
  test('retryTransaction should return 400 for non-failed transaction', async () => {
    // Arrange
    const transaction = {
      id: uuidv4(),
      type: TransactionType.PAYMENT,
      status: TransactionStatus.PENDING,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: 'idem-123',
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await transactionStore.save(transaction);
    
    const req = mockRequest({ id: transaction.id });
    const res = mockResponse();
    
    // Act
    await transactionController.retryTransaction(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'invalid_transaction_state'
        })
      })
    );
  });
  
  test('cancelRetry should cancel a pending retry', async () => {
    // Arrange
    const transaction = {
      id: uuidv4(),
      type: TransactionType.PAYMENT,
      status: TransactionStatus.RECOVERY_PENDING,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: 'idem-123',
      retryCount: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await transactionStore.save(transaction);
    
    // Add to retry queue
    await retryQueue.enqueue(transaction.id, 10000);
    
    const req = mockRequest({ id: transaction.id });
    const res = mockResponse();
    
    // Act
    await transactionController.cancelRetry(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('cancelled')
      })
    );
    
    // Verify transaction status
    const updatedTransaction = await transactionStore.get(transaction.id);
    expect(updatedTransaction?.status).toBe(TransactionStatus.FAILED);
    expect(updatedTransaction?.metadata?.retryCancelled).toBe(true);
    
    // Verify retry was removed from queue
    const pendingRetries = await retryQueue.getPendingRetries();
    expect(pendingRetries.find(r => r.transactionId === transaction.id)).toBeUndefined();
  });
  
  test('getRetryStats should return retry statistics', async () => {
    // Arrange
    // Create some transactions with various states
    const transactions = [
      {
        id: uuidv4(),
        type: TransactionType.PAYMENT,
        status: TransactionStatus.COMPLETED,
        amount: 100,
        currency: 'USD',
        customerId: 'customer-123',
        paymentMethodId: 'pm-123',
        idempotencyKey: `idem-${Date.now()}-1`,
        retryCount: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
        metadata: { completedAfterRetry: true }
      },
      {
        id: uuidv4(),
        type: TransactionType.PAYMENT,
        status: TransactionStatus.FAILED,
        amount: 200,
        currency: 'USD',
        customerId: 'customer-123',
        paymentMethodId: 'pm-123',
        idempotencyKey: `idem-${Date.now()}-2`,
        retryCount: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
        failedAt: new Date(),
        metadata: { failedAfterRetry: true }
      },
      {
        id: uuidv4(),
        type: TransactionType.PAYMENT,
        status: TransactionStatus.RECOVERY_PENDING,
        amount: 300,
        currency: 'USD',
        customerId: 'customer-123',
        paymentMethodId: 'pm-123',
        idempotencyKey: `idem-${Date.now()}-3`,
        retryCount: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    // Save all transactions
    for (const tx of transactions) {
      await transactionStore.save(tx);
    }
    
    const req = mockRequest();
    const res = mockResponse();
    
    // Act
    await transactionController.getRetryStats(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        stats: expect.objectContaining({
          pendingCount: 1,
          successRate: expect.any(Number),
          retryCountDistribution: expect.any(Object)
        })
      })
    );
  });
  
  test('getTransactions should return transactions for a customer', async () => {
    // Arrange
    const customerId = 'customer-123';
    
    // Create test transactions
    const transactions = [
      {
        id: uuidv4(),
        type: TransactionType.PAYMENT,
        status: TransactionStatus.COMPLETED,
        amount: 100,
        currency: 'USD',
        customerId,
        paymentMethodId: 'pm-123',
        idempotencyKey: `idem-${Date.now()}-1`,
        retryCount: 0,
        createdAt: new Date(Date.now() - 3600000), // 1 hour ago
        updatedAt: new Date()
      },
      {
        id: uuidv4(),
        type: TransactionType.PAYMENT,
        status: TransactionStatus.PENDING,
        amount: 200,
        currency: 'USD',
        customerId,
        paymentMethodId: 'pm-123',
        idempotencyKey: `idem-${Date.now()}-2`,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    // Save all transactions
    for (const tx of transactions) {
      await transactionStore.save(tx);
    }
    
    const req = mockRequest(
      { customerId },
      {},
      {}
    );
    req.query = {};
    
    const res = mockResponse();
    
    // Act
    await transactionController.getTransactions(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        transactions: expect.arrayContaining([
          expect.objectContaining({
            amount: 100,
            status: TransactionStatus.COMPLETED
          }),
          expect.objectContaining({
            amount: 200,
            status: TransactionStatus.PENDING
          })
        ])
      })
    );
    expect((res.json as jest.Mock).mock.calls[0][0].transactions.length).toBe(2);
  });
  
  test('getTransactions should filter by status', async () => {
    // Arrange
    const customerId = 'customer-456';
    
    // Create test transactions with different statuses
    const transactions = [
      {
        id: uuidv4(),
        type: TransactionType.PAYMENT,
        status: TransactionStatus.COMPLETED,
        amount: 100,
        currency: 'USD',
        customerId,
        paymentMethodId: 'pm-123',
        idempotencyKey: `idem-${Date.now()}-1`,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: uuidv4(),
        type: TransactionType.PAYMENT,
        status: TransactionStatus.PENDING,
        amount: 200,
        currency: 'USD',
        customerId,
        paymentMethodId: 'pm-123',
        idempotencyKey: `idem-${Date.now()}-2`,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    // Save all transactions
    for (const tx of transactions) {
      await transactionStore.save(tx);
    }
    
    const req = mockRequest(
      { customerId },
      {},
      {}
    );
    req.query = { status: TransactionStatus.COMPLETED };
    
    const res = mockResponse();
    
    // Act
    await transactionController.getTransactions(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    
    // Should only return the COMPLETED transaction
    const responseTransactions = (res.json as jest.Mock).mock.calls[0][0].transactions;
    expect(responseTransactions.length).toBe(1);
    expect(responseTransactions[0].status).toBe(TransactionStatus.COMPLETED);
    expect(responseTransactions[0].amount).toBe(100);
  });
});

    const req = mockRequest({ id: transaction.id });
    const res = mockResponse();
    
    // Act
    await transactionController.getTransaction(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        transaction: expect.objectContaining({
          id: transaction.id,
          status: transaction.status,
          amount: transaction.amount,
          currency: transaction.currency
        })
      })
    );
  });
  
  test('getTransaction should return 404 for non-existent transaction', async () => {
    // Arrange
    const req = mockRequest({ id: 'non-existent-id' });
    const res = mockResponse();
    
    // Act
    await transactionController.getTransaction(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'transaction_not_found'
        })
      })
    );
  });
  
  test('updateTransactionStatus should update a transaction status', async () => {
    // Arrange
    const transaction = {
      id: uuidv4(),
      type: TransactionType.PAYMENT,
      status: TransactionStatus.PENDING,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: 'idem-123',
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await transactionStore.save(transaction);
    
    const req = mockRequest(
      { id: transaction.id }, 
      { status: TransactionStatus.COMPLETED }
    );
    
    const res = mockResponse();
    
    // Act
    await transactionController.updateTransactionStatus(req, res);
    
    // Assert
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        transaction: expect.objectContaining({
          id: transaction.id,
          status: TransactionStatus.COMPLETED
        })
      })
    );
    
    // Verify transaction was updated in store
    const updatedTransaction = await transactionStore.get(transaction.id);
    expect(updatedTransaction?.status).toBe(TransactionStatus.COMPLETED);
  });
  
  test('retryTransaction should schedule a retry for a failed transaction', async () => {
    // Arrange
    const transaction = {
      id: uuidv4(),
      type: TransactionType.PAYMENT,
      status: TransactionStatus.FAILED,
      amount: 100,
      currency: 'USD',
      customerId: 'customer-123',
      paymentMethodId: 'pm-123',
      idempotencyKey: 'idem-123',
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      error: {
        code: TransactionErrorCode.NETWORK_ERROR,
        message: 'Network error occurred',
        recoverable: true,
        retryable: true
      }
    };
    
    await transactionStore.save(transaction);
