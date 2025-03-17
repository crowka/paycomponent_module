// src/api/controllers/payment.controller.ts
import { Request, Response } from 'express';
import { PaymentService } from '../../lib/payment/services/payment.service';
import { PaymentProviderFactory } from '../../lib/payment/providers/provider-factory';
import { EventEmitter } from '../../lib/payment/events/event.emitter';
import { EventStore } from '../../lib/payment/events/event.store';

export class PaymentController {
  private paymentService: PaymentService;
  private eventEmitter: EventEmitter;

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
    } catch (error) {
      console.error('Failed to initialize PaymentController:', error);
      throw error;
    }
  }

  processPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.paymentService) {
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
        metadata: req.body.metadata
      });
      
      res.json(result);
    } catch (error) {
      console.error('Payment processing error:', error);
      res.status(400).json({ 
        error: error.message || 'Payment processing failed',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  };

  confirmPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.paymentService) {
        await this.initialize();
      }
      
      const result = await this.paymentService.confirmPayment(
        req.params.paymentId
      );
      
      res.json(result);
    } catch (error) {
      console.error('Payment confirmation error:', error);
      res.status(400).json({ 
        error: error.message || 'Payment confirmation failed',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  };

  getPaymentMethods = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.paymentService) {
        await this.initialize();
      }
      
      const methods = await this.paymentService.getPaymentMethods(req.user.id);
      res.json(methods);
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      res.status(400).json({ 
        error: error.message || 'Failed to fetch payment methods',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  };

  addPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.paymentService) {
        await this.initialize();
      }
      
      const method = await this.paymentService.addPaymentMethod(
        req.user.id,
        req.body
      );
      
      res.status(201).json(method);
    } catch (error) {
      console.error('Error adding payment method:', error);
      res.status(400).json({ 
        error: error.message || 'Failed to add payment method',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  };

  removePaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure service is initialized
      if (!this.paymentService) {
        await this.initialize();
      }
      
      await this.paymentService.removePaymentMethod(req.params.methodId);
      res.status(204).send();
    } catch (error) {
      console.error('Error removing payment method:', error);
      res.status(400).json({ 
        error: error.message || 'Failed to remove payment method',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
  };
}
