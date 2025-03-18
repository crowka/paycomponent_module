// src/lib/payment/providers/stripe-provider.ts
import { Stripe } from 'stripe';
import { BasePaymentProvider } from './base-provider';
import { 
  CreatePaymentInput,
  PaymentResult,
  PaymentMethod,
  AddPaymentMethodInput,
  ProviderConfig
} from '../types/provider.types';
import { PaymentLogger } from '../utils/logger';
import { errorHandler, ErrorCode } from '../utils/error';

export class StripeProvider extends BasePaymentProvider {
  private client: Stripe;

  constructor() {
    super();
    this.logger = new PaymentLogger('info', 'StripeProvider');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.logger.info('Initializing Stripe provider', { 
      environment: config.environment,
      webhookConfigured: !!config.webhookSecret
    });
    
    await super.initialize(config);
    
    if (!config.apiKey) {
      const error = 'Stripe API key is required';
      this.logger.error(error);
      throw errorHandler.createError(
        error,
        ErrorCode.CONFIGURATION_ERROR,
        { provider: 'StripeProvider' }
      );
    }
    
    try {
      this.client = new Stripe(config.apiKey, {
        apiVersion: '2023-10-16'
      });
      
      // Test connection by getting account info
      const account = await this.client.accounts.retrieve();
      this.logger.info('Stripe provider initialized successfully', {
        accountId: account.id,
        environment: config.environment
      });
    } catch (error) {
      this.logger.error('Stripe initialization failed', { error });
      throw errorHandler.wrapError(
        error,
        'Failed to initialize Stripe provider',
        ErrorCode.PROVIDER_COMMUNICATION_ERROR
      );
    }
  }

  async createPayment(data: CreatePaymentInput): Promise<PaymentResult> {
    this.checkInitialization();
    
    // Validate input parameters
    this.validateCreatePaymentInput(data);
    
    const paymentId = Math.random().toString(36).substring(7);
    this.logger.info(`Creating payment [${paymentId}]`, { 
      amount: data.amount,
      currency: data.amount.currency,
      customerId: data.customer.id
    });
    
    try {
      // Convert amount to cents for Stripe
      const amount = Math.round(data.amount.amount * 100);
      
      // Prepare payment method
      let paymentMethodId: string;
      
      if (typeof data.paymentMethod === 'string') {
        paymentMethodId = data.paymentMethod;
        this.logger.info(`Using existing payment method [${paymentId}]`, { 
          methodId: paymentMethodId 
        });
      } else {
        // Create a payment method if object is provided
        this.logger.info(`Creating new payment method [${paymentId}]`);
        
        const paymentMethodResult = await this.client.paymentMethods.create({
          type: 'card',
          card: {
            number: data.paymentMethod.details.number,
            exp_month: data.paymentMethod.details.exp_month,
            exp_year: data.paymentMethod.details.exp_year,
            cvc: data.paymentMethod.details.cvc
          }
        });
        
        paymentMethodId = paymentMethodResult.id;
        this.logger.info(`Payment method created [${paymentId}]`, { 
          methodId: paymentMethodId 
        });
      }

      // Create a payment intent
      this.logger.info(`Creating payment intent [${paymentId}]`);
      const paymentIntent = await this.client.paymentIntents.create({
        amount,
        currency: data.amount.currency.toLowerCase(),
        payment_method: paymentMethodId,
        confirm: true,
        metadata: {
          ...data.metadata,
          customerId: data.customer.id
        },
        receipt_email: data.customer.email
      });

      const success = paymentIntent.status === 'succeeded';
      if (success) {
        this.logger.info(`Payment successful [${paymentId}]`, { 
          transactionId: paymentIntent.id 
        });
      } else {
        this.logger.warn(`Payment not yet succeeded [${paymentId}]`, { 
          status: paymentIntent.status,
          transactionId: paymentIntent.id
        });
      }

      return {
        success,
        transactionId: paymentIntent.id,
        metadata: paymentIntent.metadata as Record<string, any>
      };
    } catch (error) {
      this.logger.error(`Payment creation failed [${paymentId}]`, { 
        error,
        errorCode: error.code || 'unknown',
        message: error.message
      });
      
      return {
        success: false,
        error: {
          code: error.code || 'payment_failed',
          message: error.message,
          details: error.raw || error
        }
      };
    }
  }

  async confirmPayment(paymentId: string): Promise<PaymentResult> {
    this.checkInitialization();
    
    // Validate payment ID
    if (!paymentId) {
      throw errorHandler.createError(
        'Payment ID is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    const operationId = Math.random().toString(36).substring(7);
    this.logger.info(`Confirming payment [${operationId}]`, { paymentId });

    try {
      const paymentIntent = await this.client.paymentIntents.confirm(paymentId);
      
      const success = paymentIntent.status === 'succeeded';
      if (success) {
        this.logger.info(`Payment confirmation successful [${operationId}]`, { 
          paymentId, 
          status: paymentIntent.status 
        });
      } else {
        this.logger.warn(`Payment confirmation incomplete [${operationId}]`, { 
          paymentId, 
          status: paymentIntent.status 
        });
      }
      
      return {
        success,
        transactionId: paymentIntent.id,
        metadata: paymentIntent.metadata as Record<string, any>
      };
    } catch (error) {
      this.logger.error(`Payment confirmation failed [${operationId}]`, { 
        paymentId,
        error,
        errorCode: error.code || 'unknown',
        message: error.message
      });
      
      return {
        success: false,
        error: {
          code: error.code || 'confirmation_failed',
          message: error.message,
          details: error.raw || error
        }
      };
    }
  }

  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    this.checkInitialization();
    
    // Validate customer ID
    if (!customerId) {
      throw errorHandler.createError(
        'Customer ID is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    const operationId = Math.random().toString(36).substring(7);
    this.logger.info(`Fetching payment methods [${operationId}]`, { customerId });

    try {
      const methods = await this.client.paymentMethods.list({
        customer: customerId,
        type: 'card'
      });

      this.logger.info(`Retrieved payment methods [${operationId}]`, { 
        customerId,
        count: methods.data.length
      });

      return methods.data.map(method => ({
        id: method.id,
        type: 'card',
        isDefault: method.metadata?.default === 'true',
        customerId,
        details: {
          brand: method.card.brand,
          last4: method.card.last4,
          expiryMonth: method.card.exp_month,
          expiryYear: method.card.exp_year
        }
      }));
    } catch (error) {
      this.logger.error(`Error fetching payment methods [${operationId}]`, { 
        customerId,
        error,
        errorCode: error.code || 'unknown',
        message: error.message
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to fetch payment methods',
        ErrorCode.PROVIDER_COMMUNICATION_ERROR,
        { customerId }
      );
    }
  }

  async addPaymentMethod(
    customerId: string, 
    data: AddPaymentMethodInput
  ): Promise<PaymentMethod> {
    this.checkInitialization();
    
    // Validate customer ID
    if (!customerId) {
      throw errorHandler.createError(
        'Customer ID is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    // Validate payment method data
    this.validateAddPaymentMethodInput(data);
    
    const operationId = Math.random().toString(36).substring(7);
    this.logger.info(`Adding payment method [${operationId}]`, { 
      customerId, 
      type: data.type,
      setAsDefault: data.setAsDefault
    });

    try {
      // Create payment method
      this.logger.debug(`Creating payment method [${operationId}]`);
      const paymentMethod = await this.client.paymentMethods.create({
        type: 'card',
        card: {
          number: data.details.number,
          exp_month: data.details.exp_month,
          exp_year: data.details.exp_year,
          cvc: data.details.cvc
        },
        metadata: { 
          default: data.setAsDefault ? 'true' : 'false' 
        }
      });

      // Attach to customer
      this.logger.debug(`Attaching payment method to customer [${operationId}]`, {
        methodId: paymentMethod.id,
        customerId
      });
      
      await this.client.paymentMethods.attach(paymentMethod.id, {
        customer: customerId
      });

      // Set as default if requested
      if (data.setAsDefault) {
        this.logger.debug(`Setting as default payment method [${operationId}]`, {
          methodId: paymentMethod.id,
          customerId
        });
        
        await this.client.customers.update(customerId, {
          invoice_settings: {
            default_payment_method: paymentMethod.id
          }
        });
      }

      this.logger.info(`Payment method added successfully [${operationId}]`, {
        methodId: paymentMethod.id,
        customerId,
        isDefault: data.setAsDefault
      });

      return {
        id: paymentMethod.id,
        type: 'card',
        isDefault: data.setAsDefault || false,
        customerId,
        details: {
          brand: paymentMethod.card?.brand,
          last4: paymentMethod.card?.last4,
          expiryMonth: paymentMethod.card?.exp_month,
          expiryYear: paymentMethod.card?.exp_year
        }
      };
    } catch (error) {
      this.logger.error(`Error adding payment method [${operationId}]`, { 
        customerId,
        error,
        errorCode: error.code || 'unknown',
        message: error.message
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to add payment method',
        ErrorCode.PROVIDER_COMMUNICATION_ERROR,
        { customerId }
      );
    }
  }

  async removePaymentMethod(methodId: string): Promise<void> {
    this.checkInitialization();
    
    // Validate method ID
    if (!methodId) {
      throw errorHandler.createError(
        'Payment method ID is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    const operationId = Math.random().toString(36).substring(7);
    this.logger.info(`Removing payment method [${operationId}]`, { methodId });
    
    try {
      await this.client.paymentMethods.detach(methodId);
      this.logger.info(`Payment method removed successfully [${operationId}]`, { methodId });
    } catch (error) {
      this.logger.error(`Error removing payment method [${operationId}]`, { 
        methodId,
        error,
        errorCode: error.code || 'unknown',
        message: error.message
      });
      
      throw errorHandler.wrapError(
        error,
        'Failed to remove payment method',
        ErrorCode.PROVIDER_COMMUNICATION_ERROR,
        { methodId }
      );
    }
  }

  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    this.checkInitialization();
    
    // Validate webhook parameters
    if (!payload) {
      throw errorHandler.createError(
        'Webhook payload is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    if (!signature) {
      throw errorHandler.createError(
        'Webhook signature is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    const operationId = Math.random().toString(36).substring(7);
    this.logger.info(`Verifying webhook signature [${operationId}]`, {
      signatureLength: signature?.length
    });
    
    try {
      if (!this.config.webhookSecret) {
        this.logger.warn(`Webhook secret not configured [${operationId}]`);
        return false;
      }
      
      const event = this.client.webhooks.constructEvent(
        payload,
        signature,
        this.config.webhookSecret
      );
      
      this.logger.info(`Webhook signature verified [${operationId}]`, {
        eventType: event.type,
        eventId: event.id
      });
      
      return true;
    } catch (error) {
      this.logger.error(`Webhook signature verification failed [${operationId}]`, { 
        error: error.message
      });
      return false;
    }
  }
}
