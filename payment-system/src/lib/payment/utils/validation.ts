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
import { TransactionType, TransactionStatus } from '../transaction/types';

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
        return validateCardNumber(details.number);
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

// Transaction validation schema
const transactionSchema = z.object({
  type: z.nativeEnum(TransactionType),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency must be a 3-letter code'),
  customerId: z.string().min(1, 'Customer ID is required'),
  paymentMethodId: z.string().min(1, 'Payment method ID is required'),
  idempotencyKey: z.string().min(1, 'Idempotency key is required'),
  metadata: z.record(z.any()).optional()
});

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
        return validateCardNumber(details.number);
      }
      return true;
    },
    { message: 'Card details are invalid' }
  ),
  setAsDefault: z.boolean().optional()
});

// Card validation helper
function validateCardNumber(cardNumber: string): boolean {
  // Remove spaces and non-numeric characters
  const digitsOnly = cardNumber.replace(/\D/g, '');
  
  // Basic length check (most cards are 13-19 digits)
  if (digitsOnly.length < 13 || digitsOnly.length > 19) {
    return false;
  }
  
  // Luhn algorithm (mod 10)
  let sum = 0;
  let shouldDouble = false;
  
  // Loop from right to left
  for (let i = digitsOnly.length - 1; i >= 0; i--) {
    let digit = parseInt(digitsOnly.charAt(i));
    
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  
  return sum % 10 === 0;
}

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
    
    // Additional business validation for payment methods
    validatePaymentMethodBusinessRules(input);
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

export function validateTransaction(transaction: any): void {
  try {
    transactionSchema.parse(transaction);
    
    // Additional business rule validations for transactions
    validateTransactionBusinessRules(transaction);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      throw errorHandler.createError(
        `Invalid transaction: ${firstError.message}`,
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
  if (typeof input.amount === 'object' && input.amount.amount > 10000 && !input.metadata?.largeTransactionApproved) {
    throw errorHandler.createError(
      'Large transactions require explicit approval',
      ErrorCode.VALIDATION_ERROR,
      { amount: input.amount }
    );
  }
  
  // Validate customer has permission to use this payment method
  if (typeof input.paymentMethod === 'string' && input.customer) {
    // This would normally check if the payment method belongs to the customer
    // For now, we'll assume it's valid
  }
  
  // Currency support validation
  const supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
  if (typeof input.amount === 'object' && !supportedCurrencies.includes(input.amount.currency)) {
    throw errorHandler.createError(
      `Currency not supported: ${input.amount.currency}`,
      ErrorCode.VALIDATION_ERROR,
      { 
        currency: input.amount.currency,
        supportedCurrencies 
      }
    );
  }
}

function validatePaymentMethodBusinessRules(input: AddPaymentMethodInput): void {
  // Validate card expiration date if present
  if (input.type === 'card' && 
      input.details.exp_month && 
      input.details.exp_year) {
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JavaScript months are 0-based
    
    const expiryYear = parseInt(input.details.exp_year);
    const expiryMonth = parseInt(input.details.exp_month);
    
    // Full year validation (convert 2-digit to 4-digit if needed)
    const fullExpiryYear = expiryYear < 100 ? 2000 + expiryYear : expiryYear;
    
    if (fullExpiryYear < currentYear || 
        (fullExpiryYear === currentYear && expiryMonth < currentMonth)) {
      throw errorHandler.createError(
        'Payment method has expired',
        ErrorCode.PAYMENT_METHOD_INVALID,
        { 
          expiryMonth, 
          expiryYear 
        }
      );
    }
  }
  
  // Validate bank account details if applicable
  if (input.type === 'bank_account') {
    // Bank account validation logic would go here
    if (!input.details.accountNumber) {
      throw errorHandler.createError(
        'Bank account number is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
  }
}

function validateTransactionBusinessRules(transaction: any): void {
  // Validate amount based on transaction type
  if (transaction.type === TransactionType.REFUND && transaction.amount <= 0) {
    throw errorHandler.createError(
      'Refund amount must be positive',
      ErrorCode.VALIDATION_ERROR,
      { amount: transaction.amount }
    );
  }
  
  // Additional business validations could be added here
  // For example, checking transaction limits, fraud checks, etc.
}
