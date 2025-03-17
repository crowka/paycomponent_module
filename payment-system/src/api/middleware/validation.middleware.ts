// src/api/middleware/validation.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, z } from 'zod';
import {
  paymentMethodSchema,
  currencyConversionSchema,
  customerProfileSchema,
  spendingLimitsSchema,
} from '../validation/schemas';
import { TransactionManager } from '../../lib/payment/transaction/managers/transaction.manager';
import { TransactionStatus, TransactionType } from '../../lib/payment/transaction/types';

// Add missing transaction schema
const transactionSchema = z.object({
  type: z.enum(['PAYMENT', 'REFUND', 'CHARGEBACK']),
  amount: z.number().positive(),
  currency: z.string().length(3),
  paymentMethodId: z.string(),
  metadata: z.record(z.any()).optional()
});

const schemas = {
  createPaymentMethod: paymentMethodSchema,
  updatePaymentMethod: paymentMethodSchema.partial(),
  currencyConversion: currencyConversionSchema,
  createProfile: customerProfileSchema,
  updateProfile: customerProfileSchema.partial(),
  updateLimits: spendingLimitsSchema,
  createTransaction: transactionSchema,
  updateTransaction: transactionSchema.partial()
};

export class ValidationMiddleware {
  constructor(private transactionManager: TransactionManager) {}

  // Generic schema validation
  validateRequest = (schemaName: keyof typeof schemas) => {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const schema = schemas[schemaName];
        await schema.parseAsync(req.body);
        next();
      } catch (error) {
        res.status(400).json({ error: error.errors });
      }
    };
  };

  // Transaction-specific validations
  validateTransaction = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { type, amount, currency, paymentMethodId } = req.body;

      // Basic field validation
      if (!type || !Object.values(TransactionType).includes(type)) {
        res.status(400).json({ error: 'Invalid transaction type' });
        return;
      }

      if (!amount || typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ error: 'Invalid amount' });
        return;
      }

      if (!currency || typeof currency !== 'string' || currency.length !== 3) {
        res.status(400).json({ error: 'Invalid currency' });
        return;
      }

      if (!paymentMethodId || typeof paymentMethodId !== 'string') {
        res.status(400).json({ error: 'Invalid payment method' });
        return;
      }

      next();
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  validateTransactionStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const transactionId = req.params.transactionId || req.body.transactionId;

      if (!transactionId) {
        res.status(400).json({ error: 'Transaction ID is required' });
        return;
      }

      const transaction = await this.transactionManager.getTransaction(transactionId);

      if (!transaction) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      if (transaction.status === TransactionStatus.FAILED) {
        res.status(400).json({ error: 'Cannot process failed transaction' });
        return;
      }

      if (transaction.status === TransactionStatus.COMPLETED) {
        res.status(400).json({ error: 'Transaction already completed' });
        return;
      }

      req['transaction'] = transaction;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Error validating transaction status' });
    }
  };

  validateTransactionLimits = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { amount, currency } = req.body;
      const userId = req.user?.id;

      const isWithinLimits = await this.transactionManager.checkTransactionLimits(
        userId,
        amount,
        currency
      );

      if (!isWithinLimits) {
        res.status(400).json({ error: 'Transaction exceeds allowed limits' });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Error checking transaction limits' });
    }
  };
}

// Export a factory function to create middleware instance
export const createValidationMiddleware = (transactionManager: TransactionManager) => {
  const middleware = new ValidationMiddleware(transactionManager);
  return {
    validateRequest: middleware.validateRequest,
    validateTransaction: middleware.validateTransaction,
    validateTransactionStatus: middleware.validateTransactionStatus,
    validateTransactionLimits: middleware.validateTransactionLimits,
  };
};

// For backward compatibility, export a simple version that doesn't require TransactionManager
export const validateRequest = (schemaName: keyof typeof schemas) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = schemas[schemaName];
      await schema.parseAsync(req.body);
      next();
    } catch (error) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    }
  };
};
