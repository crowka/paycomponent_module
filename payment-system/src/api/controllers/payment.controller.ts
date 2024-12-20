// src/api/controllers/payment.controller.ts
import { Request, Response } from 'express';
import { PaymentService } from '../../lib/payment/services/payment.service';
import { PaymentProviderFactory } from '../../lib/payment/providers/provider-factory';

export class PaymentController {
  private paymentService: PaymentService;

  constructor() {
    const provider = PaymentProviderFactory.createProvider('stripe', {
      apiKey: process.env.STRIPE_SECRET_KEY!,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
    });
    
    this.paymentService = new PaymentService(provider);
  }

  async processPayment(req: Request, res: Response): Promise<void> {
    try {
      const result = await this.paymentService.processPayment(req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async confirmPayment(req: Request, res: Response): Promise<void> {
    try {
      const result = await this.paymentService.confirmPayment(req.params.paymentId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getPaymentMethods(req: Request, res: Response): Promise<void> {
    try {
      const methods = await this.paymentService.getPaymentMethods(req.user.id);
      res.json(methods);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async addPaymentMethod(req: Request, res: Response): Promise<void> {
    try {
      const method = await this.paymentService.addPaymentMethod(
        req.user.id,
        req.body
      );
      res.json(method);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async removePaymentMethod(req: Request, res: Response): Promise<void> {
    try {
      await this.paymentService.removePaymentMethod(req.params.methodId);
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}