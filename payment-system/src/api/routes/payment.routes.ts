// src/api/routes/payment.routes.ts
import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { validateRequest } from '../middleware/validation.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { idempotencyMiddleware } from '../middleware/idempotency.middleware';
import { rateLimiter } from '../middleware/rate-limiter';

const router = Router();
const controller = new PaymentController();

// Payment processing routes
router.post(
  '/process',
  authMiddleware,
  rateLimiter,
  idempotencyMiddleware,
  validateRequest('createPaymentMethod'),
  controller.processPayment
);

router.post(
  '/confirm/:paymentId',
  authMiddleware,
  idempotencyMiddleware,
  controller.confirmPayment
);

// Payment method routes
router.get(
  '/methods',
  authMiddleware,
  controller.getPaymentMethods
);

router.post(
  '/methods',
  authMiddleware,
  validateRequest('createPaymentMethod'),
  controller.addPaymentMethod
);

router.delete(
  '/methods/:methodId',
  authMiddleware,
  controller.removePaymentMethod
);

export default router;
