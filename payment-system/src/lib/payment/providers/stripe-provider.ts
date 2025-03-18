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
  private logger: PaymentLogger;

  constructor() {
    super();
    this.logger = new PaymentLogger('info');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    
    if (!config.apiKey) {
      throw errorHandler.createError(
        'Stripe API key is required',
        ErrorCode.CONFIGURATION_ERROR,
        { provider: 'StripeProvider' }
      );
    }
    
    this.client = new Stripe(config.apiKey, {
      apiVersion: '2023-10-16'
    });
    
    this.logger.info('Stripe provider initialized');
  }

  async createPayment(data: CreatePaymentInput): Promise<PaymentResult> {
    this.checkInitialization();
    
    try {
      // Convert amount to cents for Stripe
      const amount = Math.round(data.amount.amount * 100);
      
      // Prepare payment method
      let paymentMethodId: string;
      
      if (typeof data.paymentMethod === 'string') {
        paymentMethodId = data.paymentMethod;
      } else {
        // Create a payment method if object is provided
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
      }

      // Create a payment intent
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

      return {
        success: paymentIntent.status === 'succeeded',
        transactionId: paymentIntent.id,
        metadata: paymentIntent.metadata as Record<string, any>
      };
    } catch (error) {
      this.logger.error('Payment creation failed', { error });
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

    try {
      const paymentIntent = await this.client.paymentIntents.confirm(paymentId);
      
      return {
        success: paymentIntent.status === 'succeeded',
        transactionId: paymentIntent.id,
        metadata: paymentIntent.metadata as Record<string, any>
      };
    } catch (error) {
      this.logger.error('Payment confirmation failed', { error });
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

    try {
      const methods = await this.client.paymentMethods.list({
        customer: customerId,
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
      this.logger.error('Error fetching payment methods', { error });
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

    try {
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
          default: data.setAsDefault ? 'true' : 'false' 
        }
      });

      // Attach to customer
      await this.client.paymentMethods.attach(paymentMethod.id, {
        customer: customerId
      });

      // Set as default if requested
      if (data.setAsDefault) {
        await this.client.customers.update(customerId, {
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
          brand: paymentMethod.card?.brand,
          last4: paymentMethod.card?.last4,
          expiryMonth: paymentMethod.card?.exp_month,
          expiryYear: paymentMethod.card?.exp_year
        }
      };
    } catch (error) {
      this.logger.error('Error adding payment method', { error });
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
    
    try {
      await this.client.paymentMethods.detach(methodId);
      this.logger.info('Payment method removed', { methodId });
    } catch (error) {
      this.logger.error('Error removing payment method', { error });
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
    
    try {
      if (!this.config.webhookSecret) {
        this.logger.warn('Webhook secret not configured for Stripe');
        return false;
      }
      
      const event = this.client.webhooks.constructEvent(
        payload,
        signature,
        this.config.webhookSecret
      );
      
      return !!event;
    } catch (error) {
      this.logger.error('Webhook signature verification failed', { error });
      return false;
    }
  }
}
