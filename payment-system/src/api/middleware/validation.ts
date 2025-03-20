// src/api/middleware/validation.ts
import { Request, Response, NextFunction } from 'express';
import { validatePaymentInput } from '../../lib/payment/utils/validation';
import { logger } from '../../lib/payment/utils/logger';

/**
 * @deprecated Use validateRequest from validation.middleware.ts instead
 */
export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    logger.warn('Using deprecated validation.ts middleware', {
      path: req.path,
      method: req.method
    });
    
    validatePaymentInput(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
