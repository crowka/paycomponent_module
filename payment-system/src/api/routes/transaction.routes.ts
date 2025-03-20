// src/api/routes/transaction.routes.ts

import express from 'express';
import { TransactionController } from '../controllers/transaction.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { TransactionManager } from '../../lib/payment/transaction/managers/transaction.manager';
import { RetryManager } from '../../lib/payment/transaction/managers/retry.manager';
import { DatabaseTransactionStore } from '../../lib/payment/transaction/store/database-transaction.store';
import { RetryQueue } from '../../lib/payment/recovery/queue/retry.queue';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { RecordLocker } from '../../lib/payment/utils/record-locker';
import { container } from '../../lib/payment/container';

// Get dependencies from container
const transactionStore = container.resolve<DatabaseTransactionStore>('transactionStore');
const eventEmitter = container.resolve<EventEmitter>('eventEmitter');
const recordLocker = container.resolve<RecordLocker>('recordLocker');
const retryQueue = container.resolve<RetryQueue>('retryQueue');

// Create retry manager
const retryManager = new RetryManager(transactionStore, retryQueue, {
  eventEmitter,
  recordLocker
});

// Create transaction manager
const transactionManager = new TransactionManager(transactionStore, {
  eventEmitter,
  retryManager,
  recordLocker
});

// Create controller
const transactionController = new TransactionController(
  transactionManager,
  retryManager
);

// Create router
const router = express.Router();

// Define routes
router.post(
  '/',
  authenticateJWT,
  validateRequest('transaction'),
  transactionController.createTransaction
);

router.get(
  '/:id',
  authenticateJWT,
  transactionController.getTransaction
);

router.get(
  '/customer/:customerId',
  authenticateJWT,
  transactionController.getTransactions
);

router.patch(
  '/:id/status',
  authenticateJWT,
  validateRequest('transactionStatus'),
  transactionController.updateTransactionStatus
);

router.post(
  '/:id/retry',
  authenticateJWT,
  transactionController.retryTransaction
);

router.delete(
  '/:id/retry',
  authenticateJWT,
  transactionController.cancelRetry
);

router.get(
  '/stats/retry',
  authenticateJWT,
  transactionController.getRetryStats
);

export default router;
