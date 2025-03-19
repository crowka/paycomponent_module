// src/api/middleware/error.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { PaymentError, ErrorCode } from '../../lib/payment/utils/error';
import { PaymentLogger } from '../../lib/payment/utils/logger';
import { ZodError } from 'zod';

const logger = new PaymentLogger('info', 'ErrorMiddleware');

interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, any>;
  requestId?: string;
}

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Set default status code and error response
  let statusCode = 500;
  let errorResponse: ErrorResponse = {
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
    requestId: req.id
  };

  // Handle validation errors (Zod)
  if (error instanceof ZodError) {
    statusCode = 400;
    errorResponse = {
      error: 'Validation Error',
      message: 'Request validation failed',
      code: ErrorCode.VALIDATION_ERROR,
      details: formatZodErrors(error),
      requestId: req.id
    };

    logger.warn('Validation error', {
      path: req.path,
      method: req.method,
      errors: errorResponse.details
    });
  }
  // Handle our custom PaymentError type
  else if (error instanceof PaymentError) {
    // Map error codes to HTTP status codes
    switch (error.code) {
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.PAYMENT_VALIDATION_FAILED:
      case ErrorCode.PAYMENT_METHOD_INVALID:
        statusCode = 400;
        break;
      case ErrorCode.AUTHENTICATION_ERROR:
        statusCode = 401;
        break;
      case ErrorCode.AUTHORIZATION_ERROR:
        statusCode = 403;
        break;
      case ErrorCode.TRANSACTION_NOT_FOUND:
      case ErrorCode.CUSTOMER_NOT_FOUND:
        statusCode = 404;
        break;
      case ErrorCode.DUPLICATE_REQUEST:
      case ErrorCode.IDEMPOTENCY_ERROR:
        statusCode = 409;
        break;
      case ErrorCode.PROVIDER_ERROR:
      case ErrorCode.PROVIDER_COMMUNICATION_ERROR:
        statusCode = 502;
        break;
      default:
        statusCode = 500;
    }

    errorResponse = {
      error: error.code,
      message: error.message,
      details: error.context,
      requestId: req.id
    };

    logger.error(`Payment error: ${error.code}`, {
      statusCode,
      message: error.message,
      context: error.context,
      path: req.path
    });
  }
  // Handle other types of errors
  else {
    logger.error('Unexpected error', {
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      path: req.path
    });
  }

  // Send the response
  res.status(statusCode).json(errorResponse);
};

function formatZodErrors(error: ZodError): Record<string, string[]> {
  const formattedErrors: Record<string, string[]> = {};

  error.errors.forEach(err => {
    const path = err.path.join('.');
    
    if (!formattedErrors[path]) {
      formattedErrors[path] = [];
    }

    // Make error messages more user-friendly
    let message = err.message;
    if (err.code === 'invalid_type') {
      message = `Expected ${err.expected}, received ${err.received}`;
    }
    
    formattedErrors[path].push(message);
  });

  return formattedErrors;
}
