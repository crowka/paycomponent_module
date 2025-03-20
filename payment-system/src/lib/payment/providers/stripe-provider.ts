// src/lib/payment/providers/stripe-provider.ts - Updated implementation

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
import { v4 as uuidv4 } from 'uuid';

export class StripeProvider extends BasePaymentProvider {
  private client: Stripe;
  private isInitialized: boolean = false;

  constructor() {
    super();
    this.logger = new PaymentLogger('info', 'StripeProvider');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    if (!config.apiKey) {
      throw errorHandler.createError(
        'Stripe API key is required',
        ErrorCode.CONFIGURATION_ERROR,
        { provider: 'StripeProvider' }
      );
    }

    try {
      await super.initialize(config);
      
      this.client = new Stripe(config.apiKey, {
        apiVersion: '2023-10-16'
      });
      
      // Test connection by getting account info
      const account = await this.client.accounts.retrieve();
      this.logger.info('Stripe provider initialized successfully', {
        accountId: account.id,
        environment: config.environment
      });
      
      this.isInitialized = true;
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
    
    const operationId = uuidv4().slice(0, 8);
    this.logger.info(`[${operationId}] Creating payment`, { 
      amount: data.amount,
      currency: data.amount.currency,
      customerId: data.customer.id
    });
    
    try {
      // Convert amount to cents for Stripe
      const amount = Math.round(data.amount.amount * 100);
      let paymentMethodId: string;
      
      // Handle payment method (string ID or object)
      if (typeof data.paymentMethod === 'string') {
        paymentMethodId = data.paymentMethod;
      } else {
        // Create a payment method if object is provided
        const paymentMethodResult = await this.client.paymentMethods.create({
          type: 'card',
          card: {
            number: data.paymentMethod.details.number,
            exp_month: data.paymentMethod.details.expiryMonth || data.paymentMethod.details.exp_month,
            exp_year: data.paymentMethod.details.expiryYear || data.paymentMethod.details.exp_year,
            cvc: data.paymentMethod.details.cvc
          }
        });
        
        paymentMethodId = paymentMethodResult.id;
        this.logger.debug(`[${operationId}] Created payment method`, { methodId: paymentMethodId });
      }

      // Create payment intent
      const paymentIntent = await this.client.paymentIntents.create({
        amount,
        currency: data.amount.currency.toLowerCase(),
        payment_method: paymentMethodId,
        confirm: true,
        metadata: {
          ...data.metadata,
          customerId: data.customer.id,
          internalOperationId: operationId
        },
        receipt_email: data.customer.email,
        // Add idempotency key if available
        ...(data.metadata?.idempotencyKey && {
          idempotency_key: data.metadata.idempotencyKey
        })
      });

      const success = paymentIntent.status === 'succeeded';
      
      this.logger.info(`[${operationId}] Payment result: ${paymentIntent.status}`, {
        status: paymentIntent.status,
        intentId: paymentIntent.id
      });
      
      // Handle different payment statuses
      if (success) {
        return {
          success: true,
          transactionId: paymentIntent.id,
          metadata: {
            stripeStatus: paymentIntent.status,
            stripeChargeId: paymentIntent.latest_charge,
            operationId
          }
        };
      } else if (paymentIntent.status === 'requires_action') {
        return {
          success: false,
          transactionId: paymentIntent.id,
          metadata: {
            stripeStatus: paymentIntent.status,
            requiresAction: true,
            clientSecret: paymentIntent.client_secret,
            nextAction: paymentIntent.next_action,
            operationId
          },
          error: {
            code: 'REQUIRES_ACTION',
            message: 'Customer action is required to complete this payment',
            details: { nextAction: paymentIntent.next_action }
          }
        };
      } else {
        return {
          success: false,
          transactionId: paymentIntent.id,
          metadata: {
            stripeStatus: paymentIntent.status,
            operationId
          },
          error: {
            code: 'PAYMENT_FAILED',
            message: `Payment failed with status: ${paymentIntent.status}`,
            details: { status: paymentIntent.status }
          }
        };
      }
    } catch (error) {
      this.logger.error(`[${operationId}] Payment creation failed`, { 
        error,
        errorCode: error.code || 'unknown',
        message: error.message
      });
      
      // Handle specific Stripe errors
      if (error.type === 'StripeCardError') {
        return {
          success: false,
          error: {
            code: error.code || 'CARD_ERROR',
            message: error.message,
            details: error.raw || error
          }
        };
      }
      
      if (error.type === 'StripeInvalidRequestError') {
        return {
          success: false,
          error: {
            code: error.code || 'INVALID_REQUEST',
            message: error.message,
            details: error.raw || error
          }
        };
      }
      
      // Default error response
      return {
        success: false,
        error: {
          code: error.code || 'PAYMENT_FAILED',
          message: error.message,
          details: error.raw || error
        }
      };
    }
  }

  async confirmPayment(paymentId: string): Promise<PaymentResult> {
    this.checkInitialization();
    
    if (!paymentId) {
      throw errorHandler.createError(
        'Payment ID is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    const operationId = uuidv4().slice(0, 8);
    this.logger.info(`[${operationId}] Confirming payment`, { paymentId });

    try {
      const paymentIntent = await this.client.paymentIntents.retrieve(paymentId);
      
      // Only confirm if it needs confirmation
      if (paymentIntent.status === 'requires_confirmation' || 
          paymentIntent.status === 'requires_action' ||
          paymentIntent.status === 'requires_payment_method') {
        
        await this.client.paymentIntents.confirm(paymentId);
      }
      
      // Get the updated payment intent
      const updatedIntent = await this.client.paymentIntents.retrieve(paymentId);
      const success = updatedIntent.status === 'succeeded';
      
      this.logger.info(`[${operationId}] Payment confirmation result: ${updatedIntent.status}`, {
        paymentId,
        status: updatedIntent.status
      });
      
      if (success) {
        return {
          success: true,
          transactionId: updatedIntent.id,
          metadata: {
            stripeStatus: updatedIntent.status,
            stripeChargeId: updatedIntent.latest_charge,
            operationId
          }
        };
      } else if (updatedIntent.status === 'requires_action') {
        return {
          success: false,
          transactionId: updatedIntent.id,
          metadata: {
            stripeStatus: updatedIntent.status,
            requiresAction: true,
            clientSecret: updatedIntent.client_secret,
            nextAction: updatedIntent.next_action,
            operationId
          },
          error: {
            code: 'REQUIRES_ACTION',
            message: 'Customer action is required to complete this payment',
            details: { nextAction: updatedIntent.next_action }
          }
        };
      } else {
        return {
          success: false,
          transactionId: updatedIntent.id,
          metadata: {
            stripeStatus: updatedIntent.status,
            operationId
          },
          error: {
            code: 'PAYMENT_FAILED',
            message: `Payment failed with status: ${updatedIntent.status}`,
            details: { status: updatedIntent.status }
          }
        };
      }
    } catch (error) {
      this.logger.error(`[${operationId}] Payment confirmation failed`, { 
        error,
        paymentId,
        errorCode: error.code || 'unknown'
      });
      
      return {
        success: false,
        transactionId: paymentId,
        error: {
          code: error.code || 'CONFIRMATION_FAILED',
          message: error.message,
          details: error.raw || error
        }
      };
    }
  }

  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    this.checkInitialization();
    
    if (!customerId) {
      throw errorHandler.createError(
        'Customer ID is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    try {
      // First check if the customer exists in Stripe
      let stripeCustomerId: string;
      
      try {
        // Try to find existing customer
        const customers = await this.client.customers.list({
          limit: 1,
          email: customerId // Assuming customerId is an email or we store Stripe ID in metadata
        });
        
        if (customers.data.length > 0) {
          stripeCustomerId = customers.data[0].id;
        } else {
          // Create a new customer
          const customer = await this.client.customers.create({
            metadata: { internalId: customerId }
          });
          stripeCustomerId = customer.id;
        }
      } catch (error) {
        this.logger.error('Error finding/creating Stripe customer', { 
          error, 
          customerId 
        });
        throw error;
      }
      
      // Get payment methods
      const methods = await this.client.paymentMethods.list({
        customer: stripeCustomerId,
        type: 'card'
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
      this.logger.error('Error fetching payment methods', { 
        error, 
        customerId 
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
    
    if (!customerId) {
      throw errorHandler.createError(
        'Customer ID is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    try {
      // First check if the customer exists in Stripe
      let stripeCustomerId: string;
      
      try {
        // Try to find existing customer
        const customers = await this.client.customers.list({
          limit: 1,
          email: customerId // Assuming customerId is an email or we store Stripe ID in metadata
        });
        
        if (customers.data.length > 0) {
          stripeCustomerId = customers.data[0].id;
        } else {
          // Create a new customer
          const customer = await this.client.customers.create({
            metadata: { internalId: customerId }
          });
          stripeCustomerId = customer.id;
        }
      } catch (error) {
        this.logger.error('Error finding/creating Stripe customer', { 
          error, 
          customerId 
        });
        throw error;
      }
      
      // Create payment method
      const paymentMethod = await this.client.paymentMethods.create({
        type: 'card',
        card: {
          number: data.details.number,
          exp_month: data.details.exp_month,
          exp_year: data.details.exp_year,
          cvc: data.details.cvc
        },
        metadata: { 
          default: data.setAsDefault ? 'true' : 'false',
          internalCustomerId: customerId
        }
      });
      
      // Attach to customer
      await this.client.paymentMethods.attach(paymentMethod.id, {
        customer: stripeCustomerId
      });
      
      // Set as default if requested
      if (data.setAsDefault) {
        await this.client.customers.update(stripeCustomerId, {
          invoice_settings: {
            default_payment_method: paymentMethod.id
          }
        });
      }
      
      return {
        id: paymentMethod.id,
        type: 'card',
        isDefault: data.setAsDefault || false,
        customerId,
        details: {
          brand: paymentMethod.card.brand,
          last4: paymentMethod.card.last4,
          expiryMonth: paymentMethod.card.exp_month,
          expiryYear: paymentMethod.card.exp_year
        }
      };
    } catch (error) {
      this.logger.error('Error adding payment method', { 
        error, 
        customerId 
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
    
    if (!methodId) {
      throw errorHandler.createError(
        'Payment method ID is required',
        ErrorCode.VALIDATION_ERROR
      );
    }
    
    try {
      await this.client.paymentMethods.detach(methodId);
    } catch (error) {
      this.logger.error('Error removing payment method', { 
        error, 
        methodId 
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
    
    try {
      if (!this.config.webhookSecret) {
        this.logger.warn('Webhook secret not configured');
        return false;
      }
      
      const event = this.client.webhooks.constructEvent(
        payload,
        signature,
        this.config.webhookSecret
      );
      
      this.logger.info(`Webhook signature verified for event ${event.type}`, {
        eventId: event.id
      });
      
      return true;
    } catch (error) {
      this.logger.error('Webhook signature verification failed', { error });
      return false;
    }
  }

  private checkInitialization(): void {
    if (!this.isInitialized) {
      throw errorHandler.createError(
        'Stripe provider not initialized',
        ErrorCode.PROVIDER_NOT_INITIALIZED
      );
    }
  }
}
