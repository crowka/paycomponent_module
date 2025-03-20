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
  DUPLICATE_REQUEST = 'duplicate_request',
  
  // Recovery errors
  RECOVERY_ERROR = 'recovery_error',
  RECOVERY_LIMIT_EXCEEDED = 'recovery_limit_exceeded'
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
    requestId?: string;
  };
}

export class PaymentError extends Error {
  code: ErrorCode;
  context?: ErrorContext;
  originalError?: Error;
  isOperational: boolean;
  httpStatus: number;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    context?: ErrorContext,
    originalError?: Error,
    isOperational: boolean = true,
    httpStatus?: number
  ) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.context = context;
    this.originalError = originalError;
    this.isOperational = isOperational;
    this.httpStatus = httpStatus || this.determineHttpStatus(code);
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  // Convert to API response format
  toResponse(): { error: { code: string; message: string; requestId?: string }; success: false } {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId: this.context?.requestId
      },
      success: false
    };
  }

  // Determine HTTP status code based on error code
  private determineHttpStatus(code: ErrorCode): number {
    switch (code) {
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.PAYMENT_VALIDATION_FAILED:
      case ErrorCode.PAYMENT_METHOD_INVALID:
        return 400;
      case ErrorCode.AUTHENTICATION_ERROR:
        return 401;
      case ErrorCode.AUTHORIZATION_ERROR:
        return 403;
      case ErrorCode.TRANSACTION_NOT_FOUND:
      case ErrorCode.CUSTOMER_NOT_FOUND:
        return 404;
      case ErrorCode.DUPLICATE_REQUEST:
      case ErrorCode.IDEMPOTENCY_ERROR:
      case ErrorCode.TRANSACTION_ALREADY_PROCESSED:
        return 409;
      case ErrorCode.PROVIDER_ERROR:
      case ErrorCode.PROVIDER_COMMUNICATION_ERROR:
        return 502;
      default:
        return 500;
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
    originalError: Error | any,
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    context?: ErrorContext,
    isOperational: boolean = true
  ): PaymentError {
    // Preserve original error details in context
    const enhancedContext = {
      ...context,
      originalError: {
        message: originalError.message,
        code: originalError.code,
        stack: process.env.NODE_ENV !== 'production' ? originalError.stack : undefined
      }
    };

    return new PaymentError(
      message || originalError.message,
      code,
      enhancedContext,
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
      response.statusCode = error.httpStatus;
      response.body = {
        error: error.code,
        message: error.message,
        code: error.code,
        details: error.context,
        requestId: error.context?.requestId
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
      
      // Add request ID if available from context
      if (error.context?.requestId) {
        response.body.requestId = error.context.requestId;
      }
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
  
  /**
   * Categorizes an error for metrics and monitoring
   */
  categorizeError(error: Error | PaymentError): string {
    if (error instanceof PaymentError) {
      // Return the error code as the category
      return error.code;
    }
    
    // For non-payment errors, categorize by error name
    return error.name || 'UnknownError';
  }
  
  /**
   * Determines if an error is retryable
   */
  isRetryableError(error: Error | PaymentError): boolean {
    if (error instanceof PaymentError) {
      // Provider communication errors are typically retryable
      if (error.code === ErrorCode.PROVIDER_COMMUNICATION_ERROR) {
        return true;
      }
      
      // Check if explicitly marked as retryable in context
      return !!error.context?.retryable;
    }
    
    // Network errors are typically retryable
    if (error.name === 'NetworkError' || error.name === 'TimeoutError') {
      return true;
    }
    
    return false;
  }
}

export const errorHandler = ErrorHandler.getInstance();

/**
 * Helper function to safely extract error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  
  return 'Unknown error';
}

/**
 * Helper function to create a standardized error response for API endpoints
 */
export function createErrorResponse(
  error: Error | PaymentError | unknown,
  requestId?: string
): ErrorResponse {
  if (error instanceof PaymentError) {
    return {
      statusCode: error.httpStatus,
      body: {
        error: error.code,
        message: error.message,
        code: error.code,
        details: error.context,
        requestId: requestId || error.context?.requestId
      }
    };
  }
  
  // Default error response for non-PaymentError types
  return {
    statusCode: 500,
    body: {
      error: 'internal_error',
      message: getErrorMessage(error),
      requestId
    }
  };
}
