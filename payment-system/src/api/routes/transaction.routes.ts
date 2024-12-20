// src/api/routes/transaction.routes.ts
import { Router } from 'express';
import { TransactionController } from '../controllers/transaction.controller';
import { idempotencyMiddleware } from '../middleware/idempotency.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { validateTransactionMiddleware } from '../middleware/validation.middleware';

const router = Router();
const controller = new TransactionController();

// Transaction management routes
router.post(
  '/transactions',
  authMiddleware,
  idempotencyMiddleware,
  validateTransactionMiddleware,
  controller.createTransaction
);

router.get(
  '/transactions/:id',
  authMiddleware,
  controller.getTransaction
);

router.get(
  '/transactions',
  authMiddleware,
  controller.listTransactions
);

router.post(
  '/transactions/:id/retry',
  authMiddleware,
  controller.retryTransaction
);

router.post(
  '/transactions/:id/recover',
  authMiddleware,
  controller.recoverTransaction
);

router.post(
  '/transactions/:id/rollback',
  authMiddleware,
  controller.rollbackTransaction
);

// Monitoring routes
router.get(
  '/health',
  controller.getHealthStatus
);

router.get(
  '/metrics',
  authMiddleware,
  controller.getMetrics
);

router.get(
  '/alerts',
  authMiddleware,
  controller.getAlerts
);

router.post(
  '/alerts/:id/acknowledge',
  authMiddleware,
  controller.acknowledgeAlert
);

export default router;