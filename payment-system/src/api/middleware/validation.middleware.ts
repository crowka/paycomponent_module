// src/api/validation/schemas.ts
import { z } from 'zod';
import { PaymentMethodType } from '../../lib/payment/methods/types';
import { TransactionType, TransactionStatus } from '../../lib/payment/transaction/types';
import { ComplianceCategory } from '../../lib/payment/compliance/types';
import { ReportType } from '../../lib/payment/analytics/types';

// Helper for credit card validation via Luhn algorithm
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

// Payment Method Schemas
export const paymentMethodDetailsSchema = z.object({
  last4: z.string().optional(),
  brand: z.string().optional(),
  expiryMonth: z.number().min(1).max(12).optional(),
  expiryYear: z.number().optional(),
  number: z.string().optional().refine(
    val => !val || validateCardNumber(val),
    { message: 'Invalid card number' }
  ),
  cvc: z.string().optional().refine(
    val => !val || /^\d{3,4}$/.test(val),
    { message: 'CVC must be 3 or 4 digits' }
  ),
  bankName: z.string().optional(),
  accountType: z.string().optional(),
  walletType: z.string().optional(),
  cryptoCurrency: z.string().optional()
});

export const paymentMethodSchema = z.object({
  type: z.nativeEnum(PaymentMethodType),
  provider: z.string(),
  details: paymentMethodDetailsSchema,
  setAsDefault: z.boolean().optional()
});

// Currency Schemas
export const currencyConversionSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  from: z.string().length(3, 'Currency code must be 3 characters'),
  to: z.string().length(3, 'Currency code must be 3 characters')
});

// Customer Schemas
export const customerPreferencesSchema = z.object({
  communicationChannel: z.enum(['email', 'sms', 'push']),
  savePaymentMethods: z.boolean(),
  autoPayEnabled: z.boolean()
});

export const spendingLimitsSchema = z.object({
  daily: z.number().positive().optional(),
  weekly: z.number().positive().optional(),
  monthly: z.number().positive().optional(),
  perTransaction: z.number().positive().optional(),
  currency: z.string().length(3, 'Currency code must be 3 characters')
});

export const customerProfileSchema = z.object({
  email: z.string().email('Valid email is required'),
  name: z.string().optional(),
  defaultCurrency: z.string().length(3, 'Currency code must be 3 characters').optional(),
  preferences: customerPreferencesSchema.optional(),
  limits: spendingLimitsSchema.optional()
});

// Transaction Schemas
export const transactionSchema = z.object({
  type: z.nativeEnum(TransactionType),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency code must be 3 characters'),
  customerId: z.string().min(1, 'Customer ID is required'),
  paymentMethodId: z.string().min(1, 'Payment method ID is required'),
  idempotencyKey: z.string().min(8, 'Idempotency key must be at least 8 characters'),
  metadata: z.record(z.any()).optional()
});

export const transactionQuerySchema = z.object({
  status: z.nativeEnum(TransactionStatus).optional(),
  type: z.nativeEnum(TransactionType).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional()
});

// Analytics Schemas
export const metricsQuerySchema = z.object({
  dimension: z.string(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const reportQuerySchema = z.object({
  type: z.nativeEnum(ReportType),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().refine(
    (date, ctx) => {
      const startDate = ctx.path.includes('startDate') 
        ? date 
        : (ctx as any).data.startDate;
      return new Date(date) >= new Date(startDate);
    },
    { message: 'End date must be after start date' }
  ),
});

// Compliance Schemas
export const complianceValidationSchema = z.object({
  data: z.record(z.unknown()),
  categories: z.array(z.nativeEnum(ComplianceCategory)),
});

export const auditLogsQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  userId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  type: z.string().optional(),
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional(),
});

// Webhook Schemas
export const webhookEndpointSchema = z.object({
  url: z.string().url('Valid URL is required'),
  events: z.array(z.string()),
  secret: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

// Payment Input Schema
export const paymentInputSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3, 'Currency code must be 3 characters'),
  paymentMethodId: z.string().min(1, 'Payment method ID is required'),
  metadata: z.record(z.any()).optional()
});

// Types derived from schemas
export type PaymentMethodSchemaType = z.infer<typeof paymentMethodSchema>;
export type CustomerProfileSchemaType = z.infer<typeof customerProfileSchema>;
export type TransactionSchemaType = z.infer<typeof transactionSchema>;
export type MetricsQueryType = z.infer<typeof metricsQuerySchema>;
export type ReportQueryType = z.infer<typeof reportQuerySchema>;
export type ComplianceValidationType = z.infer<typeof complianceValidationSchema>;
export type AuditLogsQueryType = z.infer<typeof auditLogsQuerySchema>;
export type WebhookEndpointType = z.infer<typeof webhookEndpointSchema>;
export type PaymentInputType = z.infer<typeof paymentInputSchema>;
