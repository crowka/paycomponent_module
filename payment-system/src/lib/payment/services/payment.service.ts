// src/lib/payment/services/payment.service.ts
import { v4 as uuidv4 } from 'uuid';
import { 
  PaymentError, 
  ErrorCode, 
  errorHandler 
} from '../utils/error';
import { PaymentLogger } from '../utils/logger';
import { 
  CreatePaymentInput, 
  PaymentResult, 
  TransactionType, 
  TransactionStatus 
} from '../types';
import { validatePaymentInput } from '../validators/payment.validator';

export class PaymentService {
  private logger: PaymentLogger;
  private provider: any; // PaymentProvider
  private transactionManager: any; // TransactionManager

  constructor(provider: any, transactionManager: any) {
    this.logger = new PaymentLogger();
    this.provider = provider;
    this.transactionManager = transactionManager;
  }

  /**
   * Processes a payment request
   * @param input Payment input data
   * @returns Payment processing result
   */
  async processPayment(input: CreatePaymentInput): Promise<PaymentResult> {
    const operationId = this.generateOperationId();
    const requestId = input.metadata?.requestId || uuidv4();
    const context = { 
      operationId,
      requestId,
      amount: input.amount,
      customerId: input.customer.id,
      idempotencyKey: input.metadata?.idempotencyKey
    };
    
    this.logger.info(`[${operationId}] Processing payment`, context);
    
    try {
      // Input validation
      try {
        validatePaymentInput(input);
      } catch (validationError) {
        throw errorHandler.createError(
          'Payment validation failed',
          ErrorCode.PAYMENT_VALIDATION_FAILED,
          { ...context, validationErrors: validationError.errors },
          validationError
        );
      }
      
      // Create transaction record first (for idempotency)
      let transaction;
      try {
        transaction = await this.transactionManager.beginTransaction(
          TransactionType.PAYMENT,
          {
            amount: input.amount.amount,
            currency: input.amount.currency,
            customerId: input.customer.id,
            paymentMethodId: typeof input.paymentMethod === 'string' 
              ? input.paymentMethod 
              : input.paymentMethod.id,
            idempotencyKey: input.metadata?.idempotencyKey || uuidv4(),
            metadata: {
              ...input.metadata,
              operationId,
              requestId
            }
          }
        );
      } catch (txError) {
        // Check for idempotency conflicts
        if (txError.code === 'DUPLICATE_TRANSACTION') {
          throw errorHandler.createError(
            'Duplicate payment request detected',
            ErrorCode.DUPLICATE_REQUEST,
            { ...context, existingTransactionId: txError.transactionId },
            txError
          );
        }
        
        throw errorHandler.wrapError(
          txError,
          'Failed to create transaction record',
          ErrorCode.INTERNAL_ERROR,
          context
        );
      }
      
      // Update transaction to processing
      try {
        await this.transactionManager.updateTransactionStatus(
          transaction.id,
          TransactionStatus.PROCESSING
        );
      } catch (updateError) {
        throw errorHandler.wrapError(
          updateError,
          'Failed to update transaction status',
          ErrorCode.TRANSACTION_INVALID_STATE,
          { ...context, transactionId: transaction.id }
        );
      }
      
      // Process with payment provider
      try {
        const result = await this.provider.createPayment(input);
        
        if (result.success) {
          // Update transaction to completed
          await this.transactionManager.updateTransactionStatus(
            transaction.id,
            TransactionStatus.COMPLETED,
            { providerTransactionId: result.providerTransactionId }
          );
          
          this.logger.info(`[${operationId}] Payment processed successfully`, {
            transactionId: transaction.id,
            providerTransactionId: result.providerTransactionId
          });
          
          return {
            ...result,
            transactionId: transaction.id,
            requestId
          };
        } else {
          // Handle payment failure
          const errorCode = this.mapProviderErrorCode(result.error?.code);
          const error = errorHandler.createError(
            result.error?.message || 'Payment processing failed',
            errorCode,
            {
              ...context,
              transactionId: transaction.id,
              providerErrorCode: result.error?.code,
              providerErrorDetails: result.error?.details,
              recoverable: this.isErrorRecoverable(result.error?.code),
              retryable: this.isErrorRetryable(result.error?.code)
            }
          );
          
          await this.transactionManager.handleTransactionError(
            transaction.id,
            {
              code: error.code,
              message: error.message,
              details: error.context
            }
          );
          
          return {
            success: false,
            transactionId: transaction.id,
            requestId,
            error: {
              code: error.code,
              message: error.message,
              details: process.env.NODE_ENV === 'production' ? undefined : error.context
            }
          };
        }
      } catch (providerError) {
        // Determine if error is recoverable/retryable
        const errorCode = this.mapProviderErrorCode(providerError.code);
        const error = errorHandler.wrapError(
          providerError,
          providerError.message || 'Payment provider error',
          errorCode,
          {
            ...context,
            transactionId: transaction.id,
            provider: this.provider.constructor.name,
            recoverable: this.isErrorRecoverable(providerError.code),
            retryable: this.isErrorRetryable(providerError.code)
          }
        );
        
        // Log the provider error
        this.logger.error(`[${operationId}] Provider error during payment processing`, {
          error: providerError,
          transactionId: transaction.id,
          errorCode: error.code
        });
        
        // Handle transaction error through manager
        await this.transactionManager.handleTransactionError(
          transaction.id,
          {
            code: error.code,
            message: error.message,
            details: error.context
          }
        );
        
        // Return standardized error response
        return {
          success: false,
          transactionId: transaction.id,
          requestId,
          error: {
            code: error.code,
            message: error.message,
            details: process.env.NODE_ENV === 'production' ? undefined : error.context
          }
        };
      }
    } catch (error) {
      // Handle unexpected errors
      const paymentError = error instanceof PaymentError 
        ? error 
        : errorHandler.wrapError(
            error,
            'An unexpected error occurred during payment processing',
            ErrorCode.INTERNAL_ERROR,
            context,
            false // Mark as non-operational for critical errors
          );
      
      // Log the error
      errorHandler.handleError(paymentError);
      
      // Return standardized error response
      return {
        success: false,
        requestId,
        error: {
          code: paymentError.code,
          message: paymentError.message,
          details: process.env.NODE_ENV === 'production' ? undefined : paymentError.context
        }
      };
    }
  }

  /**
   * Maps provider-specific error codes to our standard error codes
   */
  private mapProviderErrorCode(providerCode?: string): ErrorCode {
    if (!providerCode) return ErrorCode.PAYMENT_FAILED;
    
    // Map provider-specific error codes to our standard error codes
    const errorCodeMap: Record<string, ErrorCode> = {
      'insufficient_funds': ErrorCode.PAYMENT_FAILED,
      'card_declined': ErrorCode.PAYMENT_FAILED,
      'invalid_card': ErrorCode.PAYMENT_METHOD_INVALID,
      'expired_card': ErrorCode.PAYMENT_METHOD_INVALID,
      'processing_error': ErrorCode.PROVIDER_ERROR,
      'api_connection_error': ErrorCode.PROVIDER_COMMUNICATION_ERROR,
      'authentication_error': ErrorCode.AUTHENTICATION_ERROR,
      'rate_limit_error': ErrorCode.PROVIDER_ERROR,
      'invalid_request': ErrorCode.VALIDATION_ERROR,
      'idempotency_error': ErrorCode.IDEMPOTENCY_ERROR
    };
    
    return errorCodeMap[providerCode] || ErrorCode.PROVIDER_ERROR;
  }
  
  /**
   * Determines if an error is recoverable (can be fixed by the user)
   */
  private isErrorRecoverable(errorCode?: string): boolean {
    const recoverableErrors = [
      'insufficient_funds',
      'card_declined',
      'invalid_card',
      'expired_card',
      'authentication_required'
    ];
    
    return errorCode ? recoverableErrors.includes(errorCode) : false;
  }
  
  /**
   * Determines if an error is retryable (can be retried automatically)
   */
  private isErrorRetryable(errorCode?: string): boolean {
    const retryableErrors = [
      'api_connection_error',
      'processing_error',
      'rate_limit_error',
      'network_error',
      'timeout_error'
    ];
    
    return errorCode ? retryableErrors.includes(errorCode) : false;
  }
  
  /**
   * Generates a unique operation ID for tracking
   */
  private generateOperationId(): string {
    return `pay_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
}
