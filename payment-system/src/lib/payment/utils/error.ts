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

export interface ErrorResponse {
  statusCode: number;
  body: {
    error: string;
    message: string;
    code?: string;
    details?: Record<string, any>;
  };
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

  handleControllerError(error: any, defaultMessage: string): ErrorResponse {
    // Default error response
    const response: ErrorResponse = {
      statusCode: 500,
      body: {
        error: 'Internal Server Error',
        message: defaultMessage || 'An unexpected error occurred'
      }
    };

    // Handle payment errors
    if (error instanceof PaymentError) {
      switch (error.code) {
        case ErrorCode.VALIDATION_ERROR:
        case ErrorCode.PAYMENT_VALIDATION_FAILED:
        case ErrorCode.PAYMENT_METHOD_INVALID:
          response.statusCode = 400;
          break;
        case ErrorCode.AUTHENTICATION_ERROR:
          response.statusCode = 401;
          break;
        case ErrorCode.AUTHORIZATION_ERROR:
          response.statusCode = 403;
          break;
        case ErrorCode.TRANSACTION_NOT_FOUND:
        case ErrorCode.CUSTOMER_NOT_FOUND:
          response.statusCode = 404;
          break;
        case ErrorCode.DUPLICATE_REQUEST:
        case ErrorCode.IDEMPOTENCY_ERROR:
          response.statusCode = 409;
          break;
        case ErrorCode.PROVIDER_ERROR:
        case ErrorCode.PROVIDER_COMMUNICATION_ERROR:
          response.statusCode = 502;
          break;
        default:
          response.statusCode = 500;
      }

      response.body = {
        error: error.code,
        message: error.message,
        code: error.code,
        details: error.context
      };
    } else if (error.name === 'ZodError') {
      // Handle validation errors
      response.statusCode = 400;
      response.body = {
        error: 'Validation Error',
        message: 'Request validation failed',
        code: ErrorCode.VALIDATION_ERROR,
        details: error.errors
      };
    } else {
      // Handle generic errors
      console.error('Unhandled error in controller:', error);
    }

    return response;
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
