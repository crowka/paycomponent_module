// src/lib/payment/services/payment.service.ts
import { 
  PaymentProviderInterface,
  CreatePaymentInput,
  PaymentResult,
  PaymentMethod,
  AddPaymentMethodInput,
  ProviderConfig
} from '../types/provider.types';
import { validatePaymentInput, validateAddPaymentMethodInput } from '../utils/validation';
import { encrypt, decrypt } from '../utils/encryption';
import { PaymentLogger } from '../utils/logger';
import { EventEmitter } from '../events/event.emitter';
import { errorHandler, ErrorCode, PaymentError } from '../utils/error';

export interface PaymentServiceOptions {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  eventEmitter?: EventEmitter;
}

export class PaymentService {
  private logger: PaymentLogger;
  private eventEmitter?: EventEmitter;

  constructor(
    private provider: PaymentProviderInterface,
    private options: PaymentServiceOptions = {}
  ) {
    // Validate that provider implements the required interface
    if (!provider || typeof provider.createPayment !== 'function') {
      throw errorHandler.createError(
        'Invalid payment provider',
        ErrorCode.CONFIGURATION_ERROR,
        { provider: provider?.constructor?.name || 'unknown' }
      );
    }
    
    this.logger = new PaymentLogger(options.logLevel || 'info', 'PaymentService');
    this.eventEmitter = options.eventEmitter;
    
    this.logger.info('Payment service initialized', { 
      provider: provider.constructor.name 
    });
  }

  async processPayment(input: CreatePaymentInput): Promise<PaymentResult> {
    const operationId = this.generateOperationId();
    this.logger.info(`[${operationId}] Processing payment`, { 
      amount: input.amount,
      customerId: input.customer.id
    });
    
    try {
      // Validate input
      try {
        validatePaymentInput(input);
      } catch (error) {
        this.logger.error(`[${operationId}] Payment validation failed`, { error });
        throw errorHandler.wrapError(
          error,
          'Payment validation failed',
          ErrorCode.PAYMENT_VALIDATION_FAILED,
          { 
            customerId: input.customer.id,
            amount: input.amount
          }
        );
      }

      // Encrypt sensitive data
      let encryptedData: CreatePaymentInput;
      try {
        encryptedData = await this.encryptSensitiveData(input);
      } catch (error) {
        this.logger.error(`[${operationId}] Data encryption failed`, { error });
        throw errorHandler.wrapError(
          error,
          'Failed to secure payment data',
          ErrorCode.INTERNAL_ERROR
        );
      }

      // Process payment
      this.logger.info(`[${operationId}] Calling payment provider`);
      const result = await this.provider.createPayment(encryptedData)
        .catch(error => {
          this.logger.error(`[${operationId}] Provider error`, { error });
          throw errorHandler.wrapError(
            error,
            'Payment provider error',
            ErrorCode.PROVIDER_ERROR,
            { 
              providerName: this.provider.constructor.name,
              errorCode: error.code
            }
          );
        });

      // Log result
      if (result.success) {
        this.logger.info(`[${operationId}] Payment successful`, { 
          transactionId: result.transactionId 
        });
        
        if (this.eventEmitter) {
          try {
            await this.eventEmitter.emit('payment.succeeded', {
              transactionId: result.transactionId,
              amount: input.amount,
              customerId: input.customer.id
            });
          } catch (error) {
            // Non-critical error, just log it
            this.logger.warn(`[${operationId}] Failed to emit success event`, { error });
          }
        }
      } else {
        this.logger.error(`[${operationId}] Payment failed`, { error: result.error });
        
        if (this.eventEmitter && result.error) {
          try {
            await this.eventEmitter.emit('payment.failed', {
              error: result.error,
              amount: input.amount,
              customerId: input.customer.id
            });
          } catch (error) {
            // Non-critical error, just log it
            this.logger.warn(`[${operationId}] Failed to emit failure event`, { error });
          }
        }
      }

      return result;
    } catch (error) {
      // If it's already a PaymentError, just propagate it
      if (error instanceof PaymentError) {
        throw error;
      }
      
      // Wrap other errors
      this.logger.error(`[${operationId}] Unhandled payment error`, { 
        error, 
        stack: error.stack 
      });
      
      throw errorHandler.wrapError(
        error,
        'Payment processing error',
        ErrorCode.PAYMENT_FAILED,
        { customerId: input.customer.id }
      );
    }
  }

  async confirmPayment(paymentId: string): Promise<PaymentResult> {
    const operationId = this.generateOperationId();
    this.logger.info(`[${operationId}] Confirming payment`, { paymentId });
    
    try {
      if (!paymentId) {
        throw errorHandler.createError(
          'Payment ID is required',
          ErrorCode.VALIDATION_ERROR
        );
      }
      
      const result = await this.provider.confirmPayment(paymentId)
        .catch(error => {
          this.logger.error(`[${operationId}] Provider error during confirmation`, { 
            error, 
            paymentId 
          });
          
          throw errorHandler.wrapError(
            error,
            'Payment confirmation failed',
            ErrorCode.PAYMENT_CONFIRMATION_FAILED,
            { paymentId }
          );
        });
      
      if (result.success) {
        this.logger.info(`[${operationId}] Payment confirmed`, { 
          transactionId: result.transactionId 
        });
        
        if (this.eventEmitter) {
          try {
            await this.eventEmitter.emit('payment.confirmed', {
              transactionId: result.transactionId
            });
          } catch (error) {
            this.logger.warn(`[${operationId}] Failed to emit confirmation event`, { error });
          }
        }
      } else {
        this.logger.error(`[${operationId}] Payment confirmation failed`, { 
          error: result.error 
        });
      }
      
      return result;
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      
      this.logger.error(`[${operationId}] Unhandled confirmation error`, { 
        error, 
        paymentId 
      });
      
      throw errorHandler.wrapError(
        error,
        'Payment confirmation error',
        ErrorCode.PAYMENT_CONFIRMATION_FAILED,
        { paymentId }
      );
    }
  }

  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    const operationId = this.generateOperationId();
    this.logger.info(`[${operationId}] Fetching payment methods`, { customerId });
    
    try {
      if (!customerId) {
        throw errorHandler.createError(
          'Customer ID is required',
          ErrorCode.VALIDATION_ERROR
        );
      }
      
      const methods = await this.provider.getPaymentMethods(customerId)
        .catch(error => {
          this.logger.error(`[${operationId}] Error fetching payment methods`, { 
            error, 
            customerId 
          });
          
          throw errorHandler.wrapError(
            error,
            'Failed to fetch payment methods',
            ErrorCode.PROVIDER_ERROR,
            { customerId }
          );
        });
      
      this.logger.info(`[${operationId}] Retrieved ${methods.length} payment methods`);
      
      return methods.map(method => ({
        ...method,
        details: this.maskSensitiveData(method.details)
      }));
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      
      this.logger.error(`[${operationId}] Unhandled error fetching payment methods`, { 
        error, 
        customerId 
      });
      
      throw errorHandler.wrapError(
        error,
        'Error fetching payment methods',
        ErrorCode.INTERNAL_ERROR,
        { customerId }
      );
    }
  }

  async addPaymentMethod(
    customerId: string,
    input: AddPaymentMethodInput
  ): Promise<PaymentMethod> {
    const operationId = this.generateOperationId();
    this.logger.info(`[${operationId}] Adding payment method`, { 
      customerId, 
      type: input.type 
    });
    
    try {
      // Validate input
      validateAddPaymentMethodInput(input);
      
      if (!customerId) {
        throw errorHandler.createError(
          'Customer ID is required',
          ErrorCode.VALIDATION_ERROR
        );
      }
      
      // Encrypt sensitive details
      let encryptedInput: AddPaymentMethodInput;
      try {
        const encryptedDetails = await encrypt(input.details);
        encryptedInput = {
          ...input,
          details: encryptedDetails
        };
      } catch (error) {
        this.logger.error(`[${operationId}] Error encrypting payment method details`, { error });
        throw errorHandler.wrapError(
          error,
          'Failed to secure payment method data',
          ErrorCode.INTERNAL_ERROR
        );
      }
      
      // Add the payment method
      const method = await this.provider.addPaymentMethod(customerId, encryptedInput)
        .catch(error => {
          this.logger.error(`[${operationId}] Provider error adding payment method`, { 
            error, 
            customerId 
          });
          
          throw errorHandler.wrapError(
            error,
            'Failed to add payment method',
            ErrorCode.PROVIDER_ERROR,
            { 
              customerId,
              methodType: input.type
            }
          );
        });

      this.logger.info(`[${operationId}] Payment method added`, { 
        methodId: method.id, 
        type: method.type 
      });

      if (this.eventEmitter) {
        try {
          await this.eventEmitter.emit('payment_method.added', {
            customerId,
            methodId: method.id,
            type: method.type
          });
        } catch (error) {
          this.logger.warn(`[${operationId}] Failed to emit payment method event`, { error });
        }
      }

      return {
        ...method,
        details: this.maskSensitiveData(method.details)
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      
      this.logger.error(`[${operationId}] Unhandled error adding payment method`, { 
        error, 
        customerId 
      });
      
      throw errorHandler.wrapError(
        error,
        'Error adding payment method',
        ErrorCode.INTERNAL_ERROR,
        { 
          customerId,
          methodType: input.type 
        }
      );
    }
  }

  async removePaymentMethod(methodId: string): Promise<void> {
    const operationId = this.generateOperationId();
    this.logger.info(`[${operationId}] Removing payment method`, { methodId });
    
    try {
      if (!methodId) {
        throw errorHandler.createError(
          'Payment method ID is required',
          ErrorCode.VALIDATION_ERROR
        );
      }
      
      await this.provider.removePaymentMethod(methodId)
        .catch(error => {
          this.logger.error(`[${operationId}] Provider error removing payment method`, { 
            error, 
            methodId 
          });
          
          throw errorHandler.wrapError(
            error,
            'Failed to remove payment method',
            ErrorCode.PROVIDER_ERROR,
            { methodId }
          );
        });
      
      this.logger.info(`[${operationId}] Payment method removed`);
      
      if (this.eventEmitter) {
        try {
          await this.eventEmitter.emit('payment_method.removed', { methodId });
        } catch (error) {
          this.logger.warn(`[${operationId}] Failed to emit payment method removal event`, { error });
        }
      }
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      
      this.logger.error(`[${operationId}] Unhandled error removing payment method`, { 
        error, 
        methodId 
      });
      
      throw errorHandler.wrapError(
        error,
        'Error removing payment method',
        ErrorCode.INTERNAL_ERROR,
        { methodId }
      );
    }
  }

  private generateOperationId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  private async encryptSensitiveData(data: CreatePaymentInput): Promise<CreatePaymentInput> {
    if (typeof data.paymentMethod === 'object') {
      return {
        ...data,
        paymentMethod: {
          ...data.paymentMethod,
          details: await encrypt(data.paymentMethod.details)
        }
      };
    }
    return data;
  }

  private maskSensitiveData(data: Record<string, any>): Record<string, any> {
    const masked = { ...data };
    if (masked.cardNumber) {
      masked.cardNumber = `****${masked.cardNumber.slice(-4)}`;
    }
    if (masked.number) {
      masked.number = `****${masked.number.slice(-4)}`;
    }
    if (masked.cvc || masked.cvv) {
      masked.cvc = '***';
      masked.cvv = '***';
    }
    return masked;
  }
}
