import { Stripe } from 'stripe';
import { BasePaymentProvider } from './base-provider';
import { 
  CreatePaymentInput,
  PaymentResult,
  PaymentMethod,
  AddPaymentMethodInput,
  ProviderConfig
} from '../types/provider.types';

export class StripeProvider extends BasePaymentProvider {
  private client: Stripe;

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.client = new Stripe(config.apiKey, {
      apiVersion: '2023-10-16'
    });
  }

  async createPayment(data: CreatePaymentInput): Promise<PaymentResult> {
    this.checkInitialization();
    
    try {
      const paymentIntent = await this.client.paymentIntents.create({
        amount: Math.round(data.amount.amount * 100), // Convert to cents
        currency: data.amount.currency.toLowerCase(),
        customer: data.customer.id,
        payment_method: typeof data.paymentMethod === 'string' 
          ? data.paymentMethod 
          : data.paymentMethod.id,
        metadata: data.metadata,
        confirm: true
      });

      return {
        success: paymentIntent.status === 'succeeded',
        transactionId: paymentIntent.id,
        metadata: paymentIntent.metadata as Record<string, any>
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error.code || 'payment_failed',
          message: error.message,
          details: error.details
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
      return {
        success: false,
        error: {
          code: error.code || 'confirmation_failed',
          message: error.message,
          details: error.details
        }
      };
    }
  }

  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    this.checkInitialization();

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
  }

  async addPaymentMethod(
    customerId: string, 
    data: AddPaymentMethodInput
  ): Promise<PaymentMethod> {
    this.checkInitialization();

    const paymentMethod = await this.client.paymentMethods.create({
      type: data.type,
      card: data.details,
      metadata: { default: data.setAsDefault ? 'true' : 'false' }
    });

    await this.client.paymentMethods.attach(paymentMethod.id, {
      customer: customerId
    });

    return {
      id: paymentMethod.id,
      type: data.type,
      isDefault: data.setAsDefault || false,
      customerId,
      details: data.details
    };
  }

  async removePaymentMethod(methodId: string): Promise<void> {
    this.checkInitialization();
    await this.client.paymentMethods.detach(methodId);
  }
}