// src/api/middleware/error.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { PaymentError, ErrorCode } from '../../lib/payment/utils/error';

export const errorMiddleware = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Set default status code and error response
  let statusCode = 500;
  let errorResponse = {
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
  };

  // Handle our custom PaymentError type
  if (error instanceof PaymentError) {
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
      default:
        statusCode = 500;
    }

    errorResponse = {
      error: error.code,
      message: error.message
    };

    // Include context in development mode
    if (process.env.NODE_ENV === 'development' && error.context) {
      errorResponse['context'] = error.context;
    }
  }

  // Log the error
  console.error(`[${new Date().toISOString()}] Error:`, {
    statusCode,
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });

  // Send the response
  res.status(statusCode).json(errorResponse);
};
