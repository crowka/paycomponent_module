// src/api/middleware/validation.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import {
  paymentMethodSchema,
  currencyConversionSchema,
  customerProfileSchema,
  spendingLimitsSchema,
  transactionSchema,
  metricsQuerySchema,
  reportQuerySchema,
  complianceValidationSchema,
  auditLogsQuerySchema,
  webhookEndpointSchema,
  paymentInputSchema
} from '../validation/enhanced-schemas';
import { PaymentLogger } from '../../lib/payment/utils/logger';

// Initialize logger
const logger = new PaymentLogger('info', 'ValidationMiddleware');

// Schema registry for validation
const schemas = {
  // Payment methods
  createPaymentMethod: paymentMethodSchema,
  updatePaymentMethod: paymentMethodSchema.partial(),
  
  // Currency
  currencyConversion: currencyConversionSchema,
  
  // Customer 
  createProfile: customerProfileSchema,
  updateProfile: customerProfileSchema.partial(),
  updateLimits: spendingLimitsSchema,
  
  // Transactions
  createTransaction: transactionSchema,
  updateTransaction: transactionSchema.partial(),
  
  // Analytics
  metricsQuery: metricsQuerySchema,
  reportQuery: reportQuerySchema,
  
  // Compliance
  complianceValidation: complianceValidationSchema,
  auditLogs: auditLogsQuerySchema,
  
  // Webhooks
  createWebhook: webhookEndpointSchema,
  updateWebhook: webhookEndpointSchema.partial(),
  
  // Payments
  processPayment: paymentInputSchema
};

// Schema location in request
interface SchemaValidationConfig {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
}

type SchemaKey = keyof typeof schemas | SchemaValidationConfig;

/**
 * Middleware to validate request data against a schema
 * 
 * @param schemaKey Either a string key from the schemas object or a SchemaValidationConfig
 * @returns Express middleware function
 */
export const validateRequest = (schemaKey: SchemaKey) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Determine if we're using a simple schema key or a configuration object
      if (typeof schemaKey === 'string') {
        // Using a predefined schema key
        const schema = schemas[schemaKey];
        
        if (!schema) {
          logger.error(`Schema "${schemaKey}" not found in schema registry`);
          return res.status(500).json({ 
            error: 'Server configuration error',
            details: 'Invalid schema reference'
          });
        }
        
        await schema.parseAsync(req.body);
      } else {
        // Using a schema configuration object
        if (schemaKey.body) {
          await schemaKey.body.parseAsync(req.body);
        }
        
        if (schemaKey.query) {
          await schemaKey.query.parseAsync(req.query);
        }
        
        if (schemaKey.params) {
          await schemaKey.params.parseAsync(req.params);
        }
      }
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = formatZodErrors(error);
        
        logger.warn('Validation error', {
          path: req.path,
          method: req.method,
          errors: formattedErrors
        });
        
        return res.status(400).json({ 
          error: 'Validation error',
          details: formattedErrors
        });
      }
      
      next(error);
    }
  };
};

/**
 * Transaction validation middleware (for backward compatibility)
 */
export const validateTransactionMiddleware = validateRequest('createTransaction');

/**
 * Helper function to format Zod errors into a more user-friendly format
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const formattedErrors: Record<string, string[]> = {};

  error.errors.forEach(err => {
    const path = err.path.join('.');
    
    if (!formattedErrors[path]) {
      formattedErrors[path] = [];
    }

    // Make error messages more user-friendly
    let message = err.message;
    if (err.code === 'invalid_type') {
      message = `Expected ${err.expected}, received ${err.received}`;
    }
    
    formattedErrors[path].push(message);
  });

  return formattedErrors;
}
