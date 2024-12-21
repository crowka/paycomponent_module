// src/api/validation/schemas.ts
import { z } from 'zod';
import { PaymentMethodType } from '../../lib/payment/methods/types';
import { TransactionType, TransactionStatus } from '../../lib/payment/transaction/types';
import { ComplianceCategory } from '../../lib/payment/compliance/types';
import { ReportType } from '../../lib/payment/analytics/types';

// Payment Method Schemas
export const paymentMethodSchema = z.object({
  type: z.nativeEnum(PaymentMethodType),
  provider: z.string(),
  details: z.record(z.any()),
  setAsDefault: z.boolean().optional()
});

// Currency Schemas
export const currencyConversionSchema = z.object({
  amount: z.number().positive(),
  from: z.string().length(3),
  to: z.string().length(3)
});

// Customer Schemas
export const customerPreferencesSchema = z.object({
  communicationChannel: z.enum(['email', 'sms', 'push']),
  savePaymentMethods: z.boolean(),
  autoPayEnabled: z.boolean()
});

export const spendingLimitsSchema = z.object({
  daily: z.number().optional(),
  weekly: z.number().optional(),
  monthly: z.number().optional(),
  perTransaction: z.number().optional(),
  currency: z.string().length(3)
});

export const customerProfileSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  defaultCurrency: z.string().length(3).optional(),
  preferences: customerPreferencesSchema.optional(),
  limits: spendingLimitsSchema.optional()
});

// Transaction Schemas
export const transactionSchema = z.object({
  type: z.nativeEnum(TransactionType),
  amount: z.number().positive(),
  currency: z.string().length(3),
  customerId: z.string().uuid(),
  paymentMethodId: z.string(),
  idempotencyKey: z.string(),
  metadata: z.record(z.any()).optional()
});

export const updateTransactionSchema = transactionSchema.partial().extend({
  status: z.nativeEnum(TransactionStatus)
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
      const start = ctx.path[0] === 'startDate' ? date : ctx.path[0];
      return new Date(date) >= new Date(start);
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
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  type: z.string().optional(),
});

// Types derived from schemas
export type PaymentMethodSchemaType = z.infer<typeof paymentMethodSchema>;
export type CustomerProfileSchemaType = z.infer<typeof customerProfileSchema>;
export type TransactionSchemaType = z.infer<typeof transactionSchema>;
export type MetricsQueryType = z.infer<typeof metricsQuerySchema>;
export type ReportQueryType = z.infer<typeof reportQuerySchema>;
export type ComplianceValidationType = z.infer<typeof complianceValidationSchema>;
export type AuditLogsQueryType = z.infer<typeof auditLogsQuerySchema>;
