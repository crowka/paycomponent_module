// src/api/middleware/transaction.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { TransactionManager } from '../../lib/payment/transaction/transaction.manager';
import { TransactionStatus } from '../../lib/payment/transaction/types';

export class TransactionMiddleware {
  constructor(private transactionManager: TransactionManager) {}

  checkTransactionStatus = async (
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

      // Store transaction in request for later use
      req['transaction'] = transaction;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Error processing transaction' });
    }
  };

  validateTransactionState = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const transaction = req['transaction'];

      if (!transaction) {
        res.status(400).json({ error: 'Transaction not found in request' });
        return;
      }

      // Check if transaction is in a valid state for the requested operation
      if (transaction.status === TransactionStatus.FAILED) {
        res.status(400).json({ error: 'Cannot process failed transaction' });
        return;
      }

      if (transaction.status === TransactionStatus.COMPLETED) {
        res.status(400).json({ error: 'Transaction already completed' });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Error validating transaction state' });
    }
  };

  checkTransactionLimits = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { amount, currency } = req.body;
      const userId = req.user?.id; // Assuming user info is available in request

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
export const createTransactionMiddleware = (transactionManager: TransactionManager) => {
  const middleware = new TransactionMiddleware(transactionManager);
  return {
    checkTransactionStatus: middleware.checkTransactionStatus,
    validateTransactionState: middleware.validateTransactionState,
    checkTransactionLimits: middleware.checkTransactionLimits,
  };
};