// src/lib/payment/services/payment.service.ts
import { 
  PaymentProviderInterface,
  CreatePaymentInput,
  PaymentResult,
  PaymentMethod,
  AddPaymentMethodInput
} from '../types/provider.types';
import { validatePaymentInput } from '../utils/validation';
import { encrypt, decrypt } from '../utils/encryption';
import { PaymentLogger } from '../utils/logger';
import { EventEmitter } from '../events/event.emitter';

export class PaymentService {
  private logger: PaymentLogger;
  private eventEmitter?: EventEmitter;

  constructor(
    private provider: PaymentProviderInterface,
    private options: PaymentServiceOptions = {}
  ) {
    this.logger = new PaymentLogger(options.logLevel || 'info');
    this.eventEmitter = options.eventEmitter;
  }

  async processPayment(input: CreatePaymentInput): Promise<PaymentResult> {
    try {
      // Validate input
      validatePaymentInput(input);

      // Encrypt sensitive data
      const encryptedData = await this.encryptSensitiveData(input);

      // Process payment
      this.logger.info('Processing payment', { amount: input.amount });
      const result = await this.provider.createPayment(encryptedData);

      // Log result
      if (result.success) {
        this.logger.info('Payment successful', { transactionId: result.transactionId });
        
        if (this.eventEmitter) {
          await this.eventEmitter.emit('payment.succeeded', {
            transactionId: result.transactionId,
            amount: input.amount,
            customerId: input.customer.id
          });
        }
      } else {
        this.logger.error('Payment failed', { error: result.error });
        
        if (this.eventEmitter && result.error) {
          await this.eventEmitter.emit('payment.failed', {
            error: result.error,
            amount: input.amount,
            customerId: input.customer.id
          });
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Payment processing error', { error });
      throw error;
    }
  }

  async confirmPayment(paymentId: string): Promise<PaymentResult> {
    try {
      const result = await this.provider.confirmPayment(paymentId);
      
      if (result.success) {
        this.logger.info('Payment confirmed', { transactionId: result.transactionId });
        
        if (this.eventEmitter) {
          await this.eventEmitter.emit('payment.confirmed', {
            transactionId: result.transactionId
          });
        }
      } else {
        this.logger.error('Payment confirmation failed', { error: result.error });
      }
      
      return result;
    } catch (error) {
      this.logger.error('Payment confirmation error', { error });
      throw error;
    }
  }

  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    try {
      const methods = await this.provider.getPaymentMethods(customerId);
      return methods.map(method => ({
        ...method,
        details: this.maskSensitiveData(method.details)
      }));
    } catch (error) {
      this.logger.error('Error fetching payment methods', { error });
      throw error;
    }
  }

  async addPaymentMethod(
    customerId: string,
    input: AddPaymentMethodInput
  ): Promise<PaymentMethod> {
    try {
      const encryptedDetails = await encrypt(input.details);
      const method = await this.provider.addPaymentMethod(customerId, {
        ...input,
        details: encryptedDetails
      });

      if (this.eventEmitter) {
        await this.eventEmitter.emit('payment_method.added', {
          customerId,
          methodId: method.id,
          type: method.type
        });
      }

      return {
        ...method,
        details: this.maskSensitiveData(method.details)
      };
    } catch (error) {
      this.logger.error('Error adding payment method', { error });
      throw error;
    }
  }

  async removePaymentMethod(methodId: string): Promise<void> {
    try {
      await this.provider.removePaymentMethod(methodId);
      this.logger.info('Payment method removed', { methodId });
      
      if (this.eventEmitter) {
        await this.eventEmitter.emit('payment_method.removed', { methodId });
      }
    } catch (error) {
      this.logger.error('Error removing payment method', { error });
      throw error;
    }
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
    return masked;
  }
}

interface PaymentServiceOptions {
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  eventEmitter?: EventEmitter;
}
