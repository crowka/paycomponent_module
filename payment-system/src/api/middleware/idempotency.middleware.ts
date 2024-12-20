// src/api/middleware/idempotency.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { IdempotencyManager } from '../../lib/payment/transaction/utils/idempotency';

export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    res.status(400).json({ error: 'Idempotency key is required' });
    return;
  }

  try {
    const idempotencyManager = new IdempotencyManager();
    await idempotencyManager.checkAndLock(idempotencyKey as string);
    next();
  } catch (error) {
    if (error.message === 'Duplicate request') {
      res.status(409).json({ error: 'Duplicate request' });
      return;
    }
    next(error);
  }
};