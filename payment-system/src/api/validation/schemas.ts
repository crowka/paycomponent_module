// src/api/validation/schemas.ts
import { z } from 'zod';
import {
  PaymentMethodType,
  TransactionType,
  TransactionStatus,
  ComplianceCategory,
  ReportType
} from '../../lib/payment/types';

// Import from enhanced-schemas to avoid duplication
import {
  paymentMethodSchema,
  customerPreferencesSchema,
  spendingLimitsSchema,
  customerProfileSchema,
  currencyConversionSchema,
  transactionSchema,
  metricsQuerySchema,
  reportQuerySchema,
  complianceValidationSchema,
  auditLogsQuerySchema,
  // Types
  PaymentMethodSchemaType,
  CustomerProfileSchemaType,
  TransactionSchemaType,
  MetricsQueryType,
  ReportQueryType,
  ComplianceValidationType,
  AuditLogsQueryType
} from './enhanced-schemas';

// Re-export schemas from enhanced-schemas
export {
  paymentMethodSchema,
  customerPreferencesSchema,
  spendingLimitsSchema,
  customerProfileSchema,
  currencyConversionSchema,
  transactionSchema,
  metricsQuerySchema,
  reportQuerySchema,
  complianceValidationSchema,
  auditLogsQuerySchema
};

// Re-export types
export {
  PaymentMethodSchemaType,
  CustomerProfileSchemaType,
  TransactionSchemaType,
  MetricsQueryType,
  ReportQueryType,
  ComplianceValidationType,
  AuditLogsQueryType
};

// Export simplified schemas for backward compatibility
// These are kept in case there are existing references to them
export const updateTransactionSchema = transactionSchema.partial().extend({
  status: z.nativeEnum(TransactionStatus)
});
