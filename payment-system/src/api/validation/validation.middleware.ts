// src/api/middleware/validation.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject } from 'zod';
import {
  paymentMethodSchema,
  currencyConversionSchema,
  customerProfileSchema,
  spendingLimitsSchema
} from '../validation/schemas';

const schemas = {
  createPaymentMethod: paymentMethodSchema,
  updatePaymentMethod: paymentMethodSchema.partial(),
  currencyConversion: currencyConversionSchema,
  createProfile: customerProfileSchema,
  updateProfile: customerProfileSchema.partial(),
  updateLimits: spendingLimitsSchema
};

export const validateRequest = (schemaName: keyof typeof schemas) => {
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