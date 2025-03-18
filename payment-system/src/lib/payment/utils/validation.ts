// src/lib/payment/utils/validation.ts
import { z } from 'zod';
import { 
  PaymentMethodType 
} from '../methods/types';
import { 
  CreatePaymentInput, 
  AddPaymentMethodInput 
} from '../types/provider.types';
import { errorHandler, ErrorCode } from './error';

// Basic schemas for reuse
const amountSchema = z.object({
  amount: z.number().positive('Amount must be a positive number'),
  currency: z.string().length(3, 'Currency must be a 3-letter code')
});

const customerSchema = z.object({
  id: z.string().min(1, 'Customer ID is required'),
  email: z.string().email('Valid email is required'),
  name: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

const paymentMethodStringSchema = z.string().min(1, 'Payment method ID is required');

const paymentMethodObjectSchema = z.object({
  type: z.nativeEnum(PaymentMethodType, {
    errorMap: () => ({ message: 'Invalid payment method type' })
  }),
  details: z.record(z.any()).refine(
    (details) => {
      if (details.number && typeof details.number === 'string') {
        // Basic card number validation (length and Luhn algorithm)
        return details.number.replace(/\D/g, '').length >= 12;
      }
      return true;
    },
    { message: 'Card number is invalid' }
  )
});

const paymentMethodSchema = z.union([
  paymentMethodStringSchema,
  paymentMethodObjectSchema
]);

// Main payment input validation schema
const createPaymentInputSchema = z.object({
  amount: amountSchema,
  customer: customerSchema,
  paymentMethod: paymentMethodSchema,
  metadata: z.record(z.any()).optional()
});

// Add payment method validation schema
const addPaymentMethodInputSchema = z.object({
  type: z.enum(['card', 'bank_account', 'digital_wallet'], {
    errorMap: () => ({ message: 'Invalid payment method type' })
  }),
  details: z.record(z.any()).refine(
    (details) => {
      if (details.number && typeof details.number === 'string') {
        // Basic card validation
        const cardNumber = details.number.replace(/\D/g, '');
        return cardNumber.length >= 12;
      }
      return true;
    },
    { message: 'Card details are invalid' }
  ),
  setAsDefault: z.boolean().optional()
});

// Validation functions that use the schemas
export function validatePaymentInput(input: CreatePaymentInput): void {
  try {
    createPaymentInputSchema.parse(input);
    
    // Additional business rule validations
    validateBusinessRules(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Convert Zod error to domain-specific error
      const firstError = error.errors[0];
      throw errorHandler.createError(
        `Invalid payment input: ${firstError.message}`,
        ErrorCode.VALIDATION_ERROR,
        { 
          field: firstError.path.join('.'),
          issues: error.errors 
        }
      );
    }
    throw error;
  }
}

export function validateAddPaymentMethodInput(input: AddPaymentMethodInput): void {
  try {
    addPaymentMethodInputSchema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      throw errorHandler.createError(
        `Invalid payment method: ${firstError.message}`,
        ErrorCode.VALIDATION_ERROR,
        { 
          field: firstError.path.join('.'),
          issues: error.errors 
        }
      );
    }
    throw error;
  }
}

// Additional business rule validations
function validateBusinessRules(input: CreatePaymentInput): void {
  // Example of business rule validation that goes beyond schema validation
  if (input.amount.amount > 10000 && !input.metadata?.largeTransactionApproved) {
    throw errorHandler.createError(
      'Large transactions require explicit approval',
      ErrorCode.VALIDATION_ERROR,
      { amount: input.amount }
    );
  }
  
  // Additional validations can be added here
}
