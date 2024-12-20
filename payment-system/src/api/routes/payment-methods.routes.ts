// src/api/routes/payment-methods.routes.ts
import { Router } from 'express';
import { PaymentMethodsController } from '../controllers/payment-methods.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';

const router = Router();
const controller = new PaymentMethodsController();

router.post(
  '/',
  authMiddleware,
  validateRequest('createPaymentMethod'),
  controller.createPaymentMethod
);

router.get(
  '/',
  authMiddleware,
  controller.listPaymentMethods
);

router.get(
  '/:id',
  authMiddleware,
  controller.getPaymentMethod
);

router.patch(
  '/:id',
  authMiddleware,
  validateRequest('updatePaymentMethod'),
  controller.updatePaymentMethod
);

router.post(
  '/:id/verify',
  authMiddleware,
  controller.verifyPaymentMethod
);

router.post(
  '/:id/set-default',
  authMiddleware,
  controller.setDefaultPaymentMethod
);

router.delete(
  '/:id',
  authMiddleware,
  controller.removePaymentMethod