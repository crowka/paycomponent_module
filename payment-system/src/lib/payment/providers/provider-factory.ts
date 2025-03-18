// src/lib/payment/providers/provider-factory.ts
import { PaymentProviderInterface, ProviderConfig } from '../types/provider.types';
import { StripeProvider } from './stripe-provider';
import { errorHandler, ErrorCode } from '../utils/error';

export class PaymentProviderFactory {
  private static providers: Record<string, new () => PaymentProviderInterface> = {
    stripe: StripeProvider
  };

  static async createProvider(
    name: string,
    config: ProviderConfig
  ): Promise<PaymentProviderInterface> {
    try {
      const Provider = this.providers[name];
      
      if (!Provider) {
        throw errorHandler.createError(
          `Payment provider "${name}" not supported`,
          ErrorCode.CONFIGURATION_ERROR,
          { availableProviders: Object.keys(this.providers) }
        );
      }

      const provider = new Provider();
      await provider.initialize(config);
      
      // Validate that the provider implements all required methods
      this.validateProviderImplementation(provider);
      
      return provider;
    } catch (error) {
      if (error.code === ErrorCode.CONFIGURATION_ERROR) {
        throw error;
      }
      throw errorHandler.wrapError(
        error,
        `Failed to create payment provider "${name}"`,
        ErrorCode.CONFIGURATION_ERROR,
        { providerName: name }
      );
    }
  }

  static registerProvider(
    name: string,
    provider: new () => PaymentProviderInterface
  ): void {
    this.providers[name] = provider;
  }
  
  private static validateProviderImplementation(provider: PaymentProviderInterface): void {
    const requiredMethods = [
      'initialize', 
      'createPayment', 
      'confirmPayment', 
      'getPaymentMethods', 
      'addPaymentMethod', 
      'removePaymentMethod'
    ];
    
    for (const method of requiredMethods) {
      if (typeof provider[method] !== 'function') {
        throw errorHandler.createError(
          `Provider missing required method: ${method}`,
          ErrorCode.CONFIGURATION_ERROR,
          { provider: provider.constructor.name }
        );
      }
    }
  }
}
