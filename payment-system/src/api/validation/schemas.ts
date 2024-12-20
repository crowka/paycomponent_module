// src/api/validation/schemas.ts
import { z } from 'zod';
import { PaymentMethodType } from '../../lib/payment/methods/types';

export const paymentMethodSchema = z.object({
  type: z.nativeEnum(PaymentMethodType),
  provider: z.string(),
  details: z.record(z.any()),
  setAsDefault: z.boolean().optional()
});

export const currencyConversionSchema = z.object({
  amount: z.number().positive(),
  from: z.string().length(3),
  to: z.string().length(3)
});

export const customerProfileSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  defaultCurrency: z.string().length(3).optional(),
  preferences: z.object({
    communicationChannel: z.enum(['email', 'sms', 'push']),
    savePaymentMethods: z.boolean(),
    autoPayEnabled: z.boolean()
  }).optional(),
  limits: z.object({
    daily: z.number().optional(),
    weekly: z.number().optional(),
    monthly: z.number().optional(),
    perTransaction: z.number().optional(),
    currency: z.string().length(3)
  }).optional()
});

export const spendingLimitsSchema = z.object({
  daily: z.number().optional(),
  weekly: z.number().optional(),
  monthly: z.number().optional(),
  perTransaction: z.number().optional(),
  currency: z.string().length(3)
});
// Analytics Schemas
export const metricsQuerySchema = z.object({
  dimension: z.string(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const reportQuerySchema = z.object({
  type: z.enum(['transaction_summary', 'revenue_analysis', 'user_activity']),
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
  categories: z.array(z.string()),
});

export const auditLogsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  type: z.string().optional(),
});

// Types derived from schemas
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ComplianceValidationRequest = z.infer<typeof complianceValidationSchema>;
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;