// src/api/validation/enhanced-schemas.ts
import { z } from 'zod';
import { 
  TransactionType, 
  TransactionStatus
} from '../../lib/payment/types/transaction.types';

// Import other types you need for your schemas
// For example:
// import { PaymentMethodType } from '../../lib/payment/types/payment.types';
// import { ComplianceCategory } from '../../lib/payment/types/compliance.types';
// import { ReportType } from '../../lib/payment/types/analytics.types';
// import { WebhookEventType } from '../../lib/payment/types/webhook.types';

// Placeholder imports until we standardize all types
// Replace these with actual imports as you standardize each type
const PaymentMethodType = {
  CREDIT_CARD: 'credit_card',
  DEBIT_CARD: 'debit_card',
  BANK_ACCOUNT: 'bank_account',
  DIGITAL_WALLET: 'digital_wallet',
  CRYPTO: 'crypto'
};

const ComplianceCategory = {
  KYC: 'kyc',
  AML: 'aml',
  DATA_PROTECTION: 'data_protection',
  TRANSACTION_LIMITS: 'transaction_limits',
  REPORTING: 'reporting'
};

const ReportType = {
  TRANSACTION_VOLUME: 'transaction_volume',
  REVENUE: 'revenue',
  PAYMENT_METHODS: 'payment_methods',
  CURRENCY_USAGE: 'currency_usage',
  RISK_ANALYSIS: 'risk_analysis',
  COMPLIANCE: 'compliance'
};

const WebhookEventType = {
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_DISPUTED: 'payment.disputed',
  METHOD_ADDED: 'payment_method.added',
  METHOD_UPDATED: 'payment_method.updated',
  METHOD_REMOVED: 'payment_method.removed'
};

// Currency and Amount Validation
export const currencySchema = z.string().length(3, 'Currency must be a 3-letter code')
  .regex(/^[A-Z]{3}$/, 'Currency must be uppercase letters');

export const amountSchema = z.number()
  .positive('Amount must be positive')
  .finite('Amount must be finite')
  .multipleOf(0.01, 'Amount must have at most 2 decimal places');

// Enhanced Customer Validation
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
  currency: currencySchema
});

export const customerProfileSchema = z.object({
  email: z.string().email('Valid email required'),
  name: z.string().min(1, 'Name is required').optional(),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format').optional(),
  defaultCurrency: currencySchema.optional(),
  address: z.object({
    line1: z.string().min(1, 'Address line 1 is required'),
    line2: z.string().optional(),
    city: z.string().min(1, 'City is required'),
    state: z.string().min(1, 'State is required'),
    postalCode: z.string().min(1, 'Postal code is required'),
    country: z.string().length(2, 'Country must be ISO 2-letter code')
  }).optional(),
  preferences: customerPreferencesSchema.optional(),
  limits: spendingLimitsSchema.optional(),
  taxId: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

// Card validation helpers
export function validateLuhn(cardNumber: string): boolean {
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

// Enhanced Payment Method Validation
export const paymentMethodDetailsSchema = z.object({
  last4: z.string().optional(),
  brand: z.string().optional(),
  expiryMonth: z.number().min(1).max(12).optional(),
  expiryYear: z.number().optional(),
  number: z.string().optional().refine(
    val => !val || validateLuhn(val),
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
  type: z.enum([
    PaymentMethodType.CREDIT_CARD,
    PaymentMethodType.DEBIT_CARD,
    PaymentMethodType.BANK_ACCOUNT,
    PaymentMethodType.DIGITAL_WALLET,
    PaymentMethodType.CRYPTO
  ]),
  provider: z.string(),
  details: paymentMethodDetailsSchema,
  setAsDefault: z.boolean().optional()
});

// Currency Conversion Schema
export const currencyConversionSchema = z.object({
  amount: amountSchema,
  from: currencySchema,
  to: currencySchema
}).refine(data => data.from !== data.to, 'Source and target currencies must be different');

// Transaction Schemas
export const transactionSchema = z.object({
  type: z.nativeEnum(TransactionType),
  amount: amountSchema,
  currency: currencySchema,
  customerId: z.string().min(1, 'Customer ID is required'),
  paymentMethodId: z.string().min(1, 'Payment method ID is required'),
  idempotencyKey: z.string().min(8, 'Idempotency key must be at least 8 characters'),
  metadata: z.record(z.any()).optional(),
  description: z.string().optional(),
  returnUrl: z.string().url().optional()
});

export const transactionQuerySchema = z.object({
  status: z.nativeEnum(TransactionStatus).optional(),
  type: z.nativeEnum(TransactionType).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.number().positive().max(1000).optional(),
  offset: z.number().nonnegative().optional()
});

// Analytics Schemas
export const metricsQuerySchema = z.object({
  dimension: z.string(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const reportQuerySchema = z.object({
  type: z.enum([
    ReportType.TRANSACTION_VOLUME,
    ReportType.REVENUE,
    ReportType.PAYMENT_METHODS,
    ReportType.CURRENCY_USAGE,
    ReportType.RISK_ANALYSIS,
    ReportType.COMPLIANCE
  ]),
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
  categories: z.array(z.enum([
    ComplianceCategory.KYC,
    ComplianceCategory.AML,
    ComplianceCategory.DATA_PROTECTION,
    ComplianceCategory.TRANSACTION_LIMITS,
    ComplianceCategory.REPORTING
  ])),
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
  amount: amountSchema,
  currency: currencySchema,
  paymentMethodId: z.string().min(1, 'Payment method ID is required'),
  metadata: z.record(z.any()).optional()
});

// Export validation functions
export const validatePaymentMethod = (data: unknown) => paymentMethodSchema.parse(data);
export const validateTransaction = (data: unknown) => transactionSchema.parse(data);
export const validateCustomerProfile = (data: unknown) => customerProfileSchema.parse(data);
export const validateCompliance = (data: unknown) => complianceValidationSchema.parse(data);
export const validateAnalyticsQuery = (data: unknown) => metricsQuerySchema.parse(data);
export const validateWebhook = (data: unknown) => webhookEndpointSchema.parse(data);
export const validateCurrencyExchange = (data: unknown) => currencyConversionSchema.parse(data);

// Export types
export type PaymentMethodSchemaType = z.infer<typeof paymentMethodSchema>;
export type CustomerProfileSchemaType = z.infer<typeof customerProfileSchema>;
export type TransactionSchemaType = z.infer<typeof transactionSchema>;
export type MetricsQueryType = z.infer<typeof metricsQuerySchema>;
export type ReportQueryType = z.infer<typeof reportQuerySchema>;
export type ComplianceValidationType = z.infer<typeof complianceValidationSchema>;
export type AuditLogsQueryType = z.infer<typeof auditLogsQuerySchema>;
export type WebhookEndpointType = z.infer<typeof webhookEndpointSchema>;
export type PaymentInputType = z.infer<typeof paymentInputSchema>;
