// src/api/controllers/payment-methods.controller.ts
import { Request, Response } from 'express';
import { PaymentMethodManager } from '../../lib/payment/methods/payment-method.manager';
import { PaymentMethodType } from '../../lib/payment/methods/types';

export class PaymentMethodsController {
  constructor(private paymentMethodManager: PaymentMethodManager) {}

  createPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      const { type, provider, details, setAsDefault } = req.body;
      const customerId = req.user.id;

      const paymentMethod = await this.paymentMethodManager.addPaymentMethod(
        customerId,
        type as PaymentMethodType,
        provider,
        details,
        setAsDefault
      );

      res.status(201).json(paymentMethod);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  listPaymentMethods = async (req: Request, res: Response): Promise<void> => {
    try {
      const methods = await this.paymentMethodManager.getCustomerPaymentMethods(
        req.user.id
      );
      res.json(methods);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  getPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      const method = await this.paymentMethodManager.getPaymentMethod(req.params.id);
      
      if (!method) {
        res.status(404).json({ error: 'Payment method not found' });
        return;
      }

      if (method.customerId !== req.user.id) {
        res.status(403).json({ error: 'Unauthorized access' });
        return;
      }

      res.json(method);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  verifyPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      const verified = await this.paymentMethodManager.verifyPaymentMethod(
        req.params.id
      );
      res.json({ verified });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  setDefaultPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      const method = await this.paymentMethodManager.setDefaultMethod(
        req.user.id,
        req.params.id
      );
      res.json(method);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  removePaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.paymentMethodManager.removePaymentMethod(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };
}


