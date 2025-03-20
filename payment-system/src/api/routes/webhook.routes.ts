// src/api/routes/webhook.routes.ts

import express from 'express';
import { WebhookController } from '../controllers/webhook.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { validateRequest } from '../middleware/validation.middleware';
import { WebhookManager } from '../../lib/payment/webhooks/webhook.manager';
import { TransactionManager } from '../../lib/payment/transaction/managers/transaction.manager';
import { container } from '../../lib/payment/container';

// Disable body parsing for Stripe webhook endpoint
// (Stripe requires the raw body)
const rawBodyParser = express.raw({ type: 'application/json' });

// Get dependencies from container
const webhookManager = container.resolve<WebhookManager>('webhookManager');
const transactionManager = container.resolve<TransactionManager>('transactionManager');

// Load Stripe webhook secret from environment
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Create controller
const webhookController = new WebhookController(
  webhookManager,
  transactionManager,
  {
    stripeWebhookSecret
  }
);

// Create router
const router = express.Router();

// Define routes for handling provider webhooks
router.post(
  '/stripe',
  rawBodyParser,
  webhookController.handleStripeWebhook
);

// Routes for managing webhook registrations
router.post(
  '/',
  authenticateJWT,
  validateRequest('webhook'),
  webhookController.registerWebhook
);

router.get(
  '/',
  authenticateJWT,
  webhookController.getWebhooks
);

router.get(
  '/:id',
  authenticateJWT,
  webhookController.getWebhook
);

router.patch(
  '/:id',
  authenticateJWT,
  validateRequest('webhookUpdate'),
  webhookController.updateWebhook
);

router.delete(
  '/:id',
  authenticateJWT,
  webhookController.deleteWebhook
);

export default router;
