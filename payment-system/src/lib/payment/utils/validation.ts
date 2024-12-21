// src/lib/payment/utils/validation.ts
import { z } from 'zod';
import { PaymentMethodType } from '../methods/types';
import { CreatePaymentInput, PaymentAmount } from '../types/provider.types';

// Basic schemas for reuse
export const amountSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3)
});

export const customerSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  metadata: z.record(z.any()).optional()
});

export const paymentMethodSchema = z.union([
  z.string(),
  z.object({
    type: z.nativeEnum(PaymentMethodType),
    details: z.record(z.any())
  })
]);

// Main payment input validation schema
export const createPaymentInputSchema = z.object({
  amount: amountSchema,
  customer: customerSchema,
  paymentMethod: paymentMethodSchema,
  metadata: z.record(z.any()).optional()
});

// Validation functions that use the schemas
export function validatePaymentInput(input: CreatePaymentInput): void {
  try {
    createPaymentInputSchema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Convert Zod error to domain-specific error
      const firstError = error.errors[0];
      throw new Error(`Invalid payment input: ${firstError.path.join('.')} - ${firstError.message}`);
    }
    throw error;
  }
}

// Additional business rule validations
export function validateBusinessRules(input: CreatePaymentInput): void {
  // Example of business rule validation that goes beyond schema validation
  if (input.amount.amount > 10000 && !input.metadata?.largeTransactionApproved) {
    throw new Error('Large transactions require explicit approval');
  }
}
