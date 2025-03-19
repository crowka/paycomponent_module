// src/api/validation/enhanced-schemas.ts
import { z } from 'zod';
import { 
  PaymentMethodType,
  TransactionType, 
  TransactionStatus,
  ComplianceCategory,
  ReportType,
  WebhookEventType
} from '../../lib/payment/types';

// Currency and Amount Validation
export const currencySchema = z.string().length(3, 'Currency must be a 3-letter code')
  .regex(/^[A-Z]{3}$/, 'Currency must be uppercase letters');

export const amountSchema = z.number()
  .positive('Amount must be positive')
  .finite('Amount must be finite')
  .multipleOf(0.01, 'Amount must have at most 2 decimal places');

// Enhanced Customer Validation
export const customerProfileValidation = z.object({
  email: z.string().email('Valid email required'),
  name: z.string().min(1, 'Name is required'),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format').optional(),
  address: z.object({
    line1: z.string().min(1, 'Address line 1 is required'),
    line2: z.string().optional(),
    city: z.string().min(1, 'City is required'),
    state: z.string().min(1, 'State is required'),
    postalCode: z.string().min(1, 'Postal code is required'),
    country: z.string().length(2, 'Country must be ISO 2-letter code')
  }).optional(),
  taxId: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

// Enhanced Payment Method Validation
export const paymentMethodValidation = z.object({
  type: z.nativeEnum(PaymentMethodType),
  billingDetails: z.object({
    name: z.string().min(1, 'Cardholder name is required'),
    email: z.string().email('Valid email required').optional(),
    phone: z.string().optional(),
    address: z.object({
      line1: z.string().min(1, 'Address line 1 is required'),
      line2: z.string().optional(),
      city: z.string().min(1, 'City is required'),
      state: z.string().min(1, 'State is required'),
      postalCode: z.string().min(1, 'Postal code is required'),
      country: z.string().length(2, 'Country must be ISO 2-letter code')
    })
  }),
  card: z.object({
    number: z.string()
      .regex(/^[0-9]{13,19}$/, 'Invalid card number')
      .refine((num) => validateLuhn(num), 'Invalid card number checksum'),
    expMonth: z.number().min(1).max(12),
    expYear: z.number()
      .min(new Date().getFullYear() % 100)
      .max((new Date().getFullYear() % 100) + 20),
    cvc: z.string().regex(/^[0-9]{3,4}$/, 'Invalid CVC')
  }).optional(),
  bankAccount: z.object({
    accountNumber: z.string().min(1, 'Account number is required'),
    routingNumber: z.string().min(1, 'Routing number is required'),
    accountType: z.enum(['checking', 'savings']),
    accountHolderType: z.enum(['individual', 'company'])
  }).optional(),
  setAsDefault: z.boolean().optional()
}).refine(data => {
  // At least one payment method detail must be provided
  return Boolean(data.card) || Boolean(data.bankAccount);
}, 'Either card or bank account details must be provided');

// Transaction Validation
export const transactionValidation = z.object({
  type: z.nativeEnum(TransactionType),
  amount: amountSchema,
  currency: currencySchema,
  paymentMethodId: z.string().uuid('Invalid payment method ID'),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(64),
  returnUrl: z.string().url().optional(),
  confirmation: z.object({
    type: z.enum(['immediate', 'manual']),
    methodType: z.enum(['automatic', '3ds', 'redirect']).optional()
  }).optional()
});

// Compliance Validation
export const complianceValidation = z.object({
  checkType: z.enum(['kyc', 'aml', 'sanctions']),
  customerId: z.string().uuid('Invalid customer ID'),
  documentType: z.enum(['passport', 'id_card', 'drivers_license', 'company_registration']).optional(),
  documentNumber: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

// Analytics Validation
export const analyticsQueryValidation = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  dimensions: z.array(z.string()).min(1),
  metrics: z.array(z.string()).min(1),
  filters: z.array(z.object({
    field: z.string(),
    operator: z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'in', 'not_in']),
    value: z.unknown()
  })).optional(),
  sort: z.array(z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc'])
  })).optional(),
  limit: z.number().positive().max(1000).optional(),
  offset: z.number().nonnegative().optional()
}).refine(data => {
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  return end > start;
}, 'End date must be after start date');

// Webhook Validation
export const webhookValidation = z.object({
  url: z.string().url('Invalid webhook URL'),
  description: z.string().optional(),
  events: z.array(z.nativeEnum(WebhookEventType)).min(1),
  enabled: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
  authentication: z.object({
    type: z.enum(['basic', 'bearer', 'hmac']),
    credentials: z.record(z.string()).optional()
  }).optional()
});

// Currency Exchange Validation
export const currencyExchangeValidation = z.object({
  sourceCurrency: currencySchema,
  targetCurrency: currencySchema,
  amount: amountSchema,
  targetAmount: amountSchema.optional(),
  type: z.enum(['fixed_source', 'fixed_target']).optional(),
  preferredProvider: z.string().optional()
}).refine(data => data.sourceCurrency !== data.targetCurrency, 
  'Source and target currencies must be different');

// Helper Functions
function validateLuhn(cardNumber: string): boolean {
  let sum = 0;
  let isEven = false;
  
  // Loop through values starting from the rightmost digit
  for (let i = cardNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cardNumber.charAt(i), 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return (sum % 10) === 0;
}

// Export validation functions
export const validatePaymentMethod = (data: unknown) => paymentMethodValidation.parse(data);
export const validateTransaction = (data: unknown) => transactionValidation.parse(data);
export const validateCustomerProfile = (data: unknown) => customerProfileValidation.parse(data);
export const validateCompliance = (data: unknown) => complianceValidation.parse(data);
export const validateAnalyticsQuery = (data: unknown) => analyticsQueryValidation.parse(data);
export const validateWebhook = (data: unknown) => webhookValidation.parse(data);
export const validateCurrencyExchange = (data: unknown) => currencyExchangeValidation.parse(data);

// Export types
export type CustomerProfileValidation = z.infer<typeof customerProfileValidation>;
export type PaymentMethodValidation = z.infer<typeof paymentMethodValidation>;
export type TransactionValidation = z.infer<typeof transactionValidation>;
export type ComplianceValidation = z.infer<typeof complianceValidation>;
export type AnalyticsQueryValidation = z.infer<typeof analyticsQueryValidation>;
export type WebhookValidation = z.infer<typeof webhookValidation>;
export type CurrencyExchangeValidation = z.infer<typeof currencyExchangeValidation>;
