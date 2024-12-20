// src/api/middleware/validation.ts
import { Request, Response, NextFunction } from 'express';
import { validatePaymentInput } from '../../lib/payment/utils/validation';

export const validateRequest = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    validatePaymentInput(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
