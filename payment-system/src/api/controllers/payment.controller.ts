// src/api/controllers/payment.controller.ts - Updated implementation
import { Request, Response } from 'express';
import { PaymentService } from '../../lib/payment/services/payment.service';
import { PaymentProviderFactory } from '../../lib/payment/providers/provider-factory';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { EventStore } from '../../lib/payment/events/event.store';
import { DatabaseConnection } from '../../lib/payment/database/connection';
import { errorHandler, ErrorCode } from '../../lib/payment/utils/error';

export class PaymentController {
  private paymentService: PaymentService;
  private eventEmitter: EventEmitter;
  private initialized: boolean = false;

  constructor() {
    this.initialize();
  }

  private async initialize() {
    try {
      // Set up event infrastructure
      const eventStore = new EventStore();
      this.eventEmitter = new EventEmitter(eventStore);
      
      // Create payment provider
      const provider = await PaymentProviderFactory.createProvider('stripe', {
        apiKey: process.env.STRIPE_SECRET_KEY!,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
      });
      
      // Create payment service
      this.paymentService = new PaymentService(provider, {
        eventEmitter: this.eventEmitter,
        logLevel: (process.env.LOG_LEVEL as any) || 'info'
      });
      
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize PaymentController:', error);
      throw error;
    }
  }

  processPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      const result = await this.paymentService.processPayment({
        amount: {
          amount: req.body.amount,
          currency: req.body.currency
        },
        customer: {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name
        },
        paymentMethod: req.body.paymentMethodId || req.body.paymentMethod,
        metadata: {
          ...req.body.metadata,
          idempotencyKey: req.headers['idempotency-key'],
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      });
      
      if (result.success) {
        res.status(200).json(result);
      } else if (result.error?.code === 'REQUIRES_ACTION') {
        res.status(202).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      const errorResponse = errorHandler.handleControllerError(error, 'Payment processing failed');
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  };

  confirmPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      const result = await this.paymentService.confirmPayment(
        req.params.paymentId
      );
      
      if (result.success) {
        res.status(200).json(result);
      } else if (result.error?.code === 'REQUIRES_ACTION') {
        res.status(202).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      const errorResponse = errorHandler.handleControllerError(error, 'Payment confirmation failed');
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  };

  getPaymentMethods = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      const methods = await this.paymentService.getPaymentMethods(req.user.id);
      res.json(methods);
    } catch (error) {
      const errorResponse = errorHandler.handleControllerError(error, 'Failed to fetch payment methods');
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  };

  addPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      const method = await this.paymentService.addPaymentMethod(
        req.user.id,
        req.body
      );
      
      res.status(201).json(method);
    } catch (error) {
      const errorResponse = errorHandler.handleControllerError(error, 'Failed to add payment method');
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  };

  removePaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      await this.paymentService.removePaymentMethod(req.params.methodId);
      res.status(204).send();
    } catch (error) {
      const errorResponse = errorHandler.handleControllerError(error, 'Failed to remove payment method');
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  };

  // Webhook handling
  handleWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Get the webhook payload and signature
      const payload = req.body;
      const signature = req.headers['stripe-signature'] as string;
      
      if (!signature) {
        res.status(400).json({ error: 'Missing Stripe signature' });
        return;
      }
      
      // Process the webhook
      const result = await this.paymentService.processWebhook(
        'stripe',
        payload,
        signature
      );
      
      if (result.success) {
        res.status(200).json({ received: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      const errorResponse = errorHandler.handleControllerError(error, 'Webhook processing failed');
      res.status(errorResponse.statusCode).json(errorResponse.body);
    }
  };
}
