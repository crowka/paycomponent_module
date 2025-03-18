// src/lib/payment/utils/error.ts
import { PaymentLogger } from './logger';

export enum ErrorCode {
  // Payment processing errors
  PAYMENT_FAILED = 'payment_failed',
  PAYMENT_VALIDATION_FAILED = 'payment_validation_failed',
  PAYMENT_METHOD_INVALID = 'payment_method_invalid',
  PAYMENT_CONFIRMATION_FAILED = 'payment_confirmation_failed',
  
  // Provider errors
  PROVIDER_ERROR = 'provider_error',
  PROVIDER_NOT_INITIALIZED = 'provider_not_initialized',
  PROVIDER_COMMUNICATION_ERROR = 'provider_communication_error',
  
  // Transaction errors
  TRANSACTION_NOT_FOUND = 'transaction_not_found',
  TRANSACTION_ALREADY_PROCESSED = 'transaction_already_processed',
  TRANSACTION_INVALID_STATE = 'transaction_invalid_state',
  
  // Customer errors
  CUSTOMER_NOT_FOUND = 'customer_not_found',
  CUSTOMER_VALIDATION_FAILED = 'customer_validation_failed',
  
  // System errors
  INTERNAL_ERROR = 'internal_error',
  CONFIGURATION_ERROR = 'configuration_error',
  
  // Validation errors
  VALIDATION_ERROR = 'validation_error',
  
  // Authentication errors
  AUTHENTICATION_ERROR = 'authentication_error',
  AUTHORIZATION_ERROR = 'authorization_error',
  
  // Idempotency errors
  IDEMPOTENCY_ERROR = 'idempotency_error',
  DUPLICATE_REQUEST = 'duplicate_request'
}

export interface ErrorContext {
  [key: string]: any;
}

export class PaymentError extends Error {
  code: ErrorCode;
  context?: ErrorContext;
  originalError?: Error;
  isOperational: boolean;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    context?: ErrorContext,
    originalError?: Error,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.context = context;
    this.originalError = originalError;
    this.isOperational = isOperational;
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private logger: PaymentLogger;

  private constructor() {
    this.logger = new PaymentLogger();
  }

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  handleError(error: Error | PaymentError): void {
    if (this.isOperationalError(error)) {
      this.handleOperationalError(error as PaymentError);
    } else {
      this.handleCriticalError(error);
    }
  }

  createError(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    context?: ErrorContext,
    originalError?: Error,
    isOperational: boolean = true
  ): PaymentError {
    return new PaymentError(message, code, context, originalError, isOperational);
  }

  wrapError(
    originalError: Error,
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    context?: ErrorContext,
    isOperational: boolean = true
  ): PaymentError {
    return new PaymentError(
      message || originalError.message,
      code,
      context,
      originalError,
      isOperational
    );
  }

  private isOperationalError(error: Error): boolean {
    if (error instanceof PaymentError) {
      return error.isOperational;
    }
    return false;
  }

  private handleOperationalError(error: PaymentError): void {
    // Log operational errors and continue
    this.logger.error(error.message, {
      code: error.code,
      context: error.context,
      stack: error.stack
    });
  }

  private handleCriticalError(error: Error): void {
    // Log critical errors and potentially trigger alerts
    this.logger.error('Critical error occurred', {
      message: error.message,
      stack: error.stack
    });
    
    // In a production environment, this could trigger alerts or emergency procedures
    // For now, we're just logging the error
  }
}

export const errorHandler = ErrorHandler.getInstance();
